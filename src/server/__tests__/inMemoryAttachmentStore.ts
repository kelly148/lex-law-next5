/**
 * In-memory ChatAttachmentStore for CHAT-COPILOT-2 A2 tests — mirrors ownerScope (every read filters by
 * userId) + the Zod-Wall shape. Inject via setChatAttachmentStore().
 */
import type { ChatAttachmentStore, ChatAttachmentPatch } from '../db/queries/chatAttachments.js';
import {
  ChatAttachmentRowSchema,
  ChatAttachmentPartyRowSchema,
  type ChatAttachmentRow,
  type ChatAttachmentPartyRow,
} from '../../shared/schemas/chatCopilot.js';
import type { NewChatAttachment, NewChatAttachmentParty } from '../db/schema.js';

export function createInMemoryAttachmentStore(now: () => Date = () => new Date(2026, 5, 14)): ChatAttachmentStore {
  const atts: ChatAttachmentRow[] = [];
  const parties: ChatAttachmentPartyRow[] = [];

  function build(row: NewChatAttachment): ChatAttachmentRow {
    return ChatAttachmentRowSchema.parse({
      id: row.id,
      userId: row.userId,
      matterId: row.matterId,
      conversationId: row.conversationId,
      filename: row.filename ?? null,
      mimeType: row.mimeType ?? null,
      fileSize: row.fileSize ?? null,
      storageKey: row.storageKey ?? null,
      contentHash: row.contentHash ?? null,
      textContent: row.textContent ?? null,
      extractionStatus: row.extractionStatus,
      extractionError: row.extractionError ?? null,
      ocrQuality: row.ocrQuality ?? null,
      holdFlag: row.holdFlag ?? 'none',
      acceptedWithWarning: row.acceptedWithWarning ?? false,
      pinned: row.pinned ?? false,
      savedMaterialId: row.savedMaterialId ?? null,
      seq: row.seq ?? 0,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
    });
  }

  return {
    insert(row: NewChatAttachment): Promise<ChatAttachmentRow> {
      const r = build(row);
      atts.push(r);
      return Promise.resolve(r);
    },
    get(id: string, userId: string): Promise<ChatAttachmentRow | null> {
      return Promise.resolve(atts.find((a) => a.id === id && a.userId === userId) ?? null);
    },
    list(conversationId: string, userId: string, includeDeleted: boolean): Promise<ChatAttachmentRow[]> {
      const out = atts
        .filter((a) => a.conversationId === conversationId && a.userId === userId)
        .filter((a) => (includeDeleted ? true : a.deletedAt === null))
        .slice()
        .sort((a, b) => a.seq - b.seq || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      return Promise.resolve(out);
    },
    patch(id: string, userId: string, patch: ChatAttachmentPatch): Promise<ChatAttachmentRow | null> {
      const a = atts.find((x) => x.id === id && x.userId === userId);
      if (!a) return Promise.resolve(null);
      if (patch.textContent !== undefined) a.textContent = patch.textContent;
      if (patch.extractionStatus !== undefined) a.extractionStatus = patch.extractionStatus;
      if (patch.extractionError !== undefined) a.extractionError = patch.extractionError;
      if (patch.acceptedWithWarning !== undefined) a.acceptedWithWarning = patch.acceptedWithWarning;
      if (patch.pinned !== undefined) a.pinned = patch.pinned;
      if (patch.savedMaterialId !== undefined) a.savedMaterialId = patch.savedMaterialId;
      if (patch.holdFlag !== undefined) a.holdFlag = patch.holdFlag;
      if (patch.deletedAt !== undefined) a.deletedAt = patch.deletedAt;
      a.updatedAt = now();
      return Promise.resolve(a);
    },
    findByHashAcrossMatters(userId: string, contentHash: string, excludeMatterId: string): Promise<ChatAttachmentRow[]> {
      // Q3: includes PURGED rows (deletedAt set) — a re-dropped file still surfaces the cross-matter advisory.
      return Promise.resolve(
        atts.filter((a) => a.userId === userId && a.contentHash === contentHash && a.matterId !== excludeMatterId),
      );
    },
    insertParty(row: NewChatAttachmentParty): Promise<ChatAttachmentPartyRow> {
      const r = ChatAttachmentPartyRowSchema.parse({
        id: row.id,
        userId: row.userId,
        matterId: row.matterId,
        attachmentId: row.attachmentId,
        partyId: row.partyId ?? null,
        partyRole: row.partyRole ?? null,
        attribution: row.attribution,
        createdAt: now(),
      });
      parties.push(r);
      return Promise.resolve(r);
    },
    listParties(attachmentId: string, userId: string): Promise<ChatAttachmentPartyRow[]> {
      return Promise.resolve(parties.filter((p) => p.attachmentId === attachmentId && p.userId === userId));
    },
  };
}
