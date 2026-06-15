/**
 * chat_attachments + chat_attachment_party query layer (Zod Wall + ownerScope) — CHAT-COPILOT-2 A2.
 *
 * Ephemeral, by-reference chat attachments. The SOLE read/write path; every read parses through the Zod
 * Wall; every owner filter goes through ownerScope(). ingestChatAttachment() is the drop-event pipeline:
 * honesty floor (reused classifyOcr) + G5 quality assessment + Q3 cross-matter hash check (harder stop)
 * + soft matter-mismatch. purgeConversationAttachments() is the ephemeral lifecycle (conversation end /
 * do-not-persist), preserving pinned (provenance) attachments.
 *
 * TEST SEAM: setChatAttachmentStore(...) injects an in-memory store (DB-free tests).
 */
import { v4 as uuidv4 } from 'uuid';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { ZodError } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import {
  chatAttachments,
  chatAttachmentParty,
  type NewChatAttachment,
  type NewChatAttachmentParty,
} from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import {
  ChatAttachmentRowSchema,
  ChatAttachmentPartyRowSchema,
  type ChatAttachmentRow,
  type ChatAttachmentPartyRow,
  type ChatHoldFlag,
} from '../../../shared/schemas/chatCopilot.js';
import { classifyOcr, OCR_CONFIDENCE_FLOOR } from '../../intake/ocrExtract.js';
import {
  assessTitleDocumentQuality,
  computeContentHash,
  detectMatterMismatch,
  type MatterMismatchResult,
} from '../../llm/chatAttachmentQuality.js';

function parseAttachment(raw: unknown, userId: string): ChatAttachmentRow {
  try {
    return ChatAttachmentRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        { schemaName: 'chat_attachmentsRowSchema', tableName: 'chat_attachments', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' },
        { userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

// ── Store seam ────────────────────────────────────────────────────────────────────────────────────────

export interface ChatAttachmentPatch {
  textContent?: string | null;
  extractionStatus?: ChatAttachmentRow['extractionStatus'];
  extractionError?: string | null;
  acceptedWithWarning?: boolean;
  pinned?: boolean;
  savedMaterialId?: string | null;
  holdFlag?: ChatHoldFlag;
  deletedAt?: Date | null;
}

export interface ChatAttachmentStore {
  insert(row: NewChatAttachment): Promise<ChatAttachmentRow>;
  get(id: string, userId: string): Promise<ChatAttachmentRow | null>;
  list(conversationId: string, userId: string, includeDeleted: boolean): Promise<ChatAttachmentRow[]>;
  patch(id: string, userId: string, patch: ChatAttachmentPatch): Promise<ChatAttachmentRow | null>;
  /** Owner's NON-deleted attachments in a DIFFERENT matter with this content hash (Q3 cross-matter). */
  findByHashAcrossMatters(userId: string, contentHash: string, excludeMatterId: string): Promise<ChatAttachmentRow[]>;
  insertParty(row: NewChatAttachmentParty): Promise<ChatAttachmentPartyRow>;
  listParties(attachmentId: string, userId: string): Promise<ChatAttachmentPartyRow[]>;
}

const drizzleStore: ChatAttachmentStore = {
  async insert(row) {
    await db.insert(chatAttachments).values(row);
    const got = await this.get(row.id!, row.userId!);
    if (!got) throw new Error(`insertAttachment: row not found after insert (id=${row.id})`);
    return got;
  },
  async get(id, userId) {
    const rows = await db.select().from(chatAttachments).where(and(eq(chatAttachments.id, id), ownerScope(chatAttachments.userId, userId))).limit(1);
    return rows.length === 0 ? null : parseAttachment(rows[0]!, userId);
  },
  async list(conversationId, userId, includeDeleted) {
    const conds = [eq(chatAttachments.conversationId, conversationId), ownerScope(chatAttachments.userId, userId)];
    if (!includeDeleted) conds.push(isNull(chatAttachments.deletedAt));
    // Stable ordering: seq, then createdAt, then id — same-seq rows tie-break deterministically.
    const rows = await db.select().from(chatAttachments).where(and(...conds)).orderBy(asc(chatAttachments.seq), asc(chatAttachments.createdAt), asc(chatAttachments.id));
    return rows.map((r) => parseAttachment(r, userId));
  },
  async patch(id, userId, patch) {
    await db.update(chatAttachments).set(patch as Record<string, unknown>).where(and(eq(chatAttachments.id, id), ownerScope(chatAttachments.userId, userId)));
    return this.get(id, userId);
  },
  async findByHashAcrossMatters(userId, contentHash, excludeMatterId) {
    // Q3: the cross-matter advisory fires even against a PURGED prior drop — the file WAS in another matter.
    // (A conversation-end purge nulls textContent but keeps the row + hash; a full matter purge hard-deletes.)
    const rows = await db
      .select()
      .from(chatAttachments)
      .where(and(ownerScope(chatAttachments.userId, userId), eq(chatAttachments.contentHash, contentHash), ne(chatAttachments.matterId, excludeMatterId)))
      .orderBy(desc(chatAttachments.createdAt));
    return rows.map((r) => parseAttachment(r, userId));
  },
  async insertParty(row) {
    await db.insert(chatAttachmentParty).values(row);
    const got = (await this.listParties(row.attachmentId!, row.userId!)).find((p) => p.id === row.id);
    if (!got) throw new Error(`insertParty: row not found after insert (id=${row.id})`);
    return got;
  },
  async listParties(attachmentId, userId) {
    const rows = await db.select().from(chatAttachmentParty).where(and(eq(chatAttachmentParty.attachmentId, attachmentId), ownerScope(chatAttachmentParty.userId, userId)));
    return rows.map((r) => ChatAttachmentPartyRowSchema.parse(r));
  },
};

let _store: ChatAttachmentStore | null = null;
export function setChatAttachmentStore(store: ChatAttachmentStore | null): void {
  _store = store;
}
function store(): ChatAttachmentStore {
  return _store ?? drizzleStore;
}

// ── Drop-event ingest pipeline (G5 + Q3) ──────────────────────────────────────────────────────────────

export interface IngestChatAttachmentArgs {
  userId: string;
  matterId: string;
  conversationId: string;
  filename: string | null;
  mimeType: string | null;
  fileSize: number | null;
  /** The uploaded bytes — for the content hash ONLY (not persisted; store-by-reference). */
  bytes: Buffer | Uint8Array;
  /** Raw extracted text from the materials pipeline (pre-honesty-floor). */
  extractedText: string;
  meanConfidence: number | null;
  /** True for image / scanned-PDF sources (the honesty floor + graphical heuristic apply). */
  isImageSource: boolean;
  pageCount?: number | null;
  perPageConfidence?: number[] | null;
  engineSignals?: { handwritingOrSeal?: boolean; skewOrRotation?: boolean };
  holdFlag?: ChatHoldFlag;
  seq?: number;
  /** Q3 cross-matter HARD STOP: a byte-identical attachment in ANOTHER matter blocks unless the attorney
   *  explicitly overrides (then it is created + logged). */
  allowCrossMatterDuplicate?: boolean;
  /** For the SOFT matter-mismatch check. */
  matterPartyNames?: readonly string[];
  matterParcels?: readonly string[];
}

export interface IngestChatAttachmentResult {
  attachment: ChatAttachmentRow;
  crossMatterDuplicate: Array<{ matterId: string; attachmentId: string }>;
  matterMismatch: MatterMismatchResult;
}

export async function ingestChatAttachment(args: IngestChatAttachmentArgs): Promise<IngestChatAttachmentResult> {
  const contentHash = computeContentHash(args.bytes);

  // Q3 cross-matter HARD STOP — a byte-identical attachment already lives in another of the owner's matters.
  const crossMatterMatches = await store().findByHashAcrossMatters(args.userId, contentHash, args.matterId);
  if (crossMatterMatches.length > 0 && args.allowCrossMatterDuplicate !== true) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'CROSS_MATTER_DUPLICATE: this file already exists in a different matter — review before using it here.',
    });
  }

  // Honesty floor (reused): withhold sub-floor text at the DATA layer so untrustworthy OCR never enters
  // context. Applied for an image source AND, defense-in-depth, for ANY source carrying a sub-floor
  // meanConfidence (so a mislabeled OCR'd "text layer" still cannot leak low-confidence text). A genuine
  // text layer (no confidence signal) is trustworthy as-is.
  const subFloor = args.meanConfidence != null && args.meanConfidence < OCR_CONFIDENCE_FLOOR;
  const classified =
    args.isImageSource || subFloor
      ? classifyOcr(args.extractedText, args.meanConfidence ?? 0)
      : {
          textContent: args.extractedText.trim().length > 0 ? args.extractedText : null,
          extractionStatus: (args.extractedText.trim().length > 0 ? 'extracted' : 'failed') as ChatAttachmentRow['extractionStatus'],
          extractionError: args.extractedText.trim().length > 0 ? null : 'No extractable text.',
        };

  // G5 quality — assessed on the RAW extracted text so warnings surface even when the text is withheld.
  const ocrQuality = assessTitleDocumentQuality({
    text: args.extractedText,
    meanConfidence: args.meanConfidence,
    pageCount: args.pageCount ?? null,
    perPageConfidence: args.perPageConfidence ?? null,
    isImageSource: args.isImageSource,
    ...(args.engineSignals ? { engineSignals: args.engineSignals } : {}),
  });

  // Soft matter-mismatch (Q3) — advisory, logged, NEVER a hard block.
  const matterMismatch = detectMatterMismatch({
    text: args.extractedText,
    matterPartyNames: args.matterPartyNames ?? [],
    ...(args.matterParcels ? { matterParcels: args.matterParcels } : {}),
  });

  const row: NewChatAttachment = {
    id: uuidv4(),
    userId: args.userId,
    matterId: args.matterId,
    conversationId: args.conversationId,
    filename: args.filename,
    mimeType: args.mimeType,
    fileSize: args.fileSize,
    storageKey: null,
    contentHash,
    textContent: classified.textContent, // honesty floor enforced
    extractionStatus: classified.extractionStatus,
    extractionError: classified.extractionError,
    ocrQuality,
    holdFlag: args.holdFlag ?? 'none',
    acceptedWithWarning: false,
    pinned: false,
    savedMaterialId: null,
    seq: args.seq ?? 0,
  };
  const attachment = await store().insert(row);

  void emitTelemetry(
    'chat_attachment_ingested',
    {
      conversationId: args.conversationId,
      extractionStatus: attachment.extractionStatus,
      warnings: ocrQuality.warnings.join(','),
      visualReviewRequired: ocrQuality.visualReviewRequired,
      crossMatterDuplicate: crossMatterMatches.length > 0,
      matterMismatch: matterMismatch.mismatch,
    },
    { userId: args.userId, matterId: args.matterId, documentId: null, jobId: null },
  );

  return {
    attachment,
    crossMatterDuplicate: crossMatterMatches.map((a) => ({ matterId: a.matterId, attachmentId: a.id })),
    matterMismatch,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────────

/** A live (non-purged) attachment, owner-scoped, or throw NOT_FOUND. A purged ephemeral attachment is gone. */
async function getLiveOrThrow(id: string, userId: string): Promise<ChatAttachmentRow> {
  const a = await store().get(id, userId);
  if (!a || a.deletedAt !== null) throw new TRPCError({ code: 'NOT_FOUND', message: 'Attachment not found' });
  return a;
}

/** Q5: the attorney accepts the warning RISK for an attachment ("accepted risk", NOT "text is correct"). */
export async function acceptAttachmentWithWarning(id: string, userId: string): Promise<ChatAttachmentRow | null> {
  await getLiveOrThrow(id, userId);
  return store().patch(id, userId, { acceptedWithWarning: true });
}

/** Q6 seam: pin an attachment as provenance — it SURVIVES the conversation-end purge. */
export async function pinAttachment(id: string, userId: string, pinned: boolean): Promise<ChatAttachmentRow | null> {
  await getLiveOrThrow(id, userId);
  return store().patch(id, userId, { pinned });
}

/**
 * Ephemeral purge (soft-delete) of a conversation's attachments. EXCEPT pinned (provenance) attachments,
 * which survive — unless `includePinned` (a full conversation delete / matter purge overrides provenance,
 * exactly as the chat tables do). Returns the count purged.
 */
export async function purgeConversationAttachments(
  conversationId: string,
  userId: string,
  opts: { includePinned: boolean },
): Promise<number> {
  const list = await store().list(conversationId, userId, false);
  let purged = 0;
  for (const a of list) {
    if (a.pinned && !opts.includePinned) continue; // provenance-pinned survives an ordinary conversation-end purge
    // Ephemeral: drop the by-reference extracted text on purge — it must not survive the soft-delete.
    await store().patch(a.id, userId, { deletedAt: new Date(), textContent: null });
    purged += 1;
  }
  return purged;
}

/** List a conversation's live attachments (selected-for-turn surface). */
export function listChatAttachments(conversationId: string, userId: string): Promise<ChatAttachmentRow[]> {
  return store().list(conversationId, userId, false);
}

/** Read one attachment (owner-scoped). */
export function getChatAttachment(id: string, userId: string): Promise<ChatAttachmentRow | null> {
  return store().get(id, userId);
}

/** Record that an attachment was promoted to a matter_material (save-to-matter is the retention act). */
export async function markAttachmentSaved(id: string, userId: string, savedMaterialId: string): Promise<ChatAttachmentRow | null> {
  await getLiveOrThrow(id, userId); // a purged ephemeral attachment cannot be promoted to permanent retention
  return store().patch(id, userId, { savedMaterialId });
}

/** Capture party attribution at save-to-matter (Q3). */
export function attributeAttachmentParty(args: {
  userId: string;
  matterId: string;
  attachmentId: string;
  partyId: string | null;
  partyRole: string | null;
  attribution: 'explicit' | 'inferred';
}): Promise<ChatAttachmentPartyRow> {
  return store().insertParty({
    id: uuidv4(),
    userId: args.userId,
    matterId: args.matterId,
    attachmentId: args.attachmentId,
    partyId: args.partyId,
    partyRole: args.partyRole,
    attribution: args.attribution,
  });
}
