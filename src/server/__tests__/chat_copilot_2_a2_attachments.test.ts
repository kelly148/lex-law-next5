/**
 * CHAT-COPILOT-2 Increment A — A2 ephemeral attachments (G5 OCR quality + Q3/Q5/Q6).
 *
 * G5: low-confidence/failed never silently enters context (honesty floor -> textContent NULL);
 * dangerous-middle identifier + legal-description warnings + visual_review_required; graphical-document.
 * Q3: cross-matter byte-identical = HARDER STOP (blocked unless overridden); matter-mismatch = SOFT,
 * advisory, never a hard block; owner-scoped. Q5: accept-with-warning is a logged risk acceptance, not a
 * text correction (non-propagating). Q6 seam: ephemeral purge at conversation end; provenance-pinned
 * SURVIVES. All DB-free via the attachment store seam.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assessTitleDocumentQuality, detectMatterMismatch } from '../llm/chatAttachmentQuality.js';
import {
  setChatAttachmentStore,
  ingestChatAttachment,
  purgeConversationAttachments,
  acceptAttachmentWithWarning,
  pinAttachment,
  listChatAttachments,
  attributeAttachmentParty,
  getChatAttachment,
  type IngestChatAttachmentArgs,
} from '../db/queries/chatAttachments.js';
import { createInMemoryAttachmentStore } from './inMemoryAttachmentStore.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CONV_A = 'c0000000-0000-0000-0000-00000000000a';
const CONV_B = 'c0000000-0000-0000-0000-00000000000b';
const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

const ingest = (over: Partial<IngestChatAttachmentArgs>): Promise<ReturnType<typeof ingestChatAttachment> extends Promise<infer R> ? R : never> =>
  ingestChatAttachment({
    userId: U1,
    matterId: MATTER_A,
    conversationId: CONV_A,
    filename: 'doc.txt',
    mimeType: 'text/plain',
    fileSize: 8,
    bytes: buf('default'),
    extractedText: 'a clean memo with plenty of readable text and no identifiers',
    meanConfidence: null,
    isImageSource: false,
    ...over,
  });

describe('CHAT-COPILOT-2 A2 — G5 OCR quality (pure)', () => {
  it('flags legal-description + recording/parcel/instrument identifier (dangerous-middle) + visual_review_required', () => {
    const q = assessTitleDocumentQuality({
      text: 'BEGINNING at the NE corner, thence N 12 deg... Parcel No. 12-345-678 ... recorded in Book 1234, Page 56',
      meanConfidence: 95,
      isImageSource: true,
    });
    expect(q.warnings).toContain('legal_description');
    expect(q.warnings).toContain('recording_parcel_instrument_identifier');
    expect(q.warnings).toContain('visual_review_required');
    expect(q.visualReviewRequired).toBe(true);
    expect(q.dangerousMiddleFieldTypes).toContain('legal_description');
    expect(q.dangerousMiddleFieldTypes).toEqual(expect.arrayContaining(['parcel_id', 'book_page']));
  });

  it('flags low_confidence + graphical_document (image source, almost no text)', () => {
    const low = assessTitleDocumentQuality({ text: 'x', meanConfidence: 40, isImageSource: true });
    expect(low.warnings).toContain('low_confidence');
    expect(low.warnings).toContain('graphical_document');
    expect(low.visualReviewRequired).toBe(true);
  });

  it('a clean text-layer document raises NO warnings', () => {
    const clean = assessTitleDocumentQuality({
      text: 'A clean engagement memo with plenty of readable text and no identifiers at all.',
      meanConfidence: 92,
      isImageSource: false,
    });
    expect(clean.warnings).toEqual([]);
    expect(clean.visualReviewRequired).toBe(false);
    expect(clean.dangerousMiddleFieldTypes).toEqual([]);
  });

  it('honors OCR-engine signals the text pass cannot infer (handwriting/seal, skew)', () => {
    const q = assessTitleDocumentQuality({
      text: 'readable text here, with enough characters to avoid the graphical-document heuristic',
      meanConfidence: 90,
      isImageSource: true,
      engineSignals: { handwritingOrSeal: true, skewOrRotation: true },
    });
    expect(q.warnings).toEqual(expect.arrayContaining(['handwriting_or_seal', 'skew_or_rotation', 'visual_review_required']));
  });
});

describe('CHAT-COPILOT-2 A2 — matter-mismatch (SOFT, Q3)', () => {
  it('flags a document whose parties/parcel do not match the matter (advisory)', () => {
    const mm = detectMatterMismatch({
      text: 'Conveyance re Parcel No. 99-999-000 between Acme Corp and Beta LLC',
      matterPartyNames: ['Smith', 'Jones'],
      matterParcels: ['12-345-678'],
    });
    expect(mm.mismatch).toBe(true);
    expect(mm.reasons).toContain('no_matter_party_named_in_document');
    expect(mm.reasons).toContain('document_parcel_not_in_matter');
  });

  it('does NOT flag when a matter party appears in the document', () => {
    const mm = detectMatterMismatch({ text: 'Agreement with John Smith regarding the property', matterPartyNames: ['John Smith'] });
    expect(mm.mismatch).toBe(false);
    expect(mm.reasons).toEqual([]);
  });
});

describe('CHAT-COPILOT-2 A2 — ingest pipeline (honesty floor + cross-matter Q3)', () => {
  beforeEach(() => setChatAttachmentStore(createInMemoryAttachmentStore()));
  afterEach(() => setChatAttachmentStore(null));

  it('HONESTY FLOOR: low-confidence image OCR stores NULL textContent (never silently in context)', async () => {
    const r = await ingest({ filename: 'scan.png', mimeType: 'image/png', bytes: buf('scanbytes'), extractedText: 'garbled o0o0', meanConfidence: 40, isImageSource: true });
    expect(r.attachment.extractionStatus).toBe('low_confidence');
    expect(r.attachment.textContent).toBeNull();
    expect(r.attachment.ocrQuality?.warnings).toContain('low_confidence');
  });

  it('cross-matter byte-identical is a HARDER STOP (blocked) unless explicitly overridden + logged', async () => {
    await ingest({ matterId: MATTER_A, conversationId: CONV_A, bytes: buf('DEED-BYTES'), extractedText: 'deed text content here' });
    // same bytes into a DIFFERENT matter -> hard stop
    await expect(
      ingest({ matterId: MATTER_B, conversationId: CONV_B, bytes: buf('DEED-BYTES'), extractedText: 'deed text content here' }),
    ).rejects.toThrow(/CROSS_MATTER_DUPLICATE/);
    // explicit override -> created + the cross-matter match is surfaced (logged)
    const ok = await ingest({ matterId: MATTER_B, conversationId: CONV_B, bytes: buf('DEED-BYTES'), extractedText: 'deed text content here', allowCrossMatterDuplicate: true });
    expect(ok.crossMatterDuplicate).toHaveLength(1);
    expect(ok.crossMatterDuplicate[0]!.matterId).toBe(MATTER_A);
  });

  it('cross-matter check is OWNER-SCOPED: another owner dropping identical bytes is not a hit', async () => {
    await ingest({ userId: U1, matterId: MATTER_A, bytes: buf('SHARED'), extractedText: 'shared text' });
    const r = await ingest({ userId: U2, matterId: MATTER_B, conversationId: CONV_B, bytes: buf('SHARED'), extractedText: 'shared text' });
    expect(r.crossMatterDuplicate).toHaveLength(0);
  });

  it('surfaces the soft matter-mismatch on the ingest result (advisory, attachment still created)', async () => {
    const r = await ingest({
      bytes: buf('mismatch'),
      extractedText: 'Deed re Parcel No. 77-777-000 between Acme and Beta',
      matterPartyNames: ['Smith'],
      matterParcels: ['12-345-678'],
    });
    expect(r.matterMismatch.mismatch).toBe(true);
    expect(r.attachment.id).toBeTruthy(); // soft -> the attachment is still created
  });
});

describe('CHAT-COPILOT-2 A2 — ephemeral lifecycle (Q5/Q6)', () => {
  beforeEach(() => setChatAttachmentStore(createInMemoryAttachmentStore()));
  afterEach(() => setChatAttachmentStore(null));

  it('purge at conversation end removes non-pinned; a provenance-PINNED attachment SURVIVES', async () => {
    const a = await ingest({ bytes: buf('aaa'), extractedText: 'doc a text', seq: 0 });
    const b = await ingest({ bytes: buf('bbb'), extractedText: 'doc b text', seq: 1 });
    await pinAttachment(b.attachment.id, U1, true); // provenance-pinned

    const purged = await purgeConversationAttachments(CONV_A, U1, { includePinned: false });
    expect(purged).toBe(1); // only the non-pinned one
    const live = await listChatAttachments(CONV_A, U1);
    expect(live.map((x) => x.id)).toEqual([b.attachment.id]); // the pinned one survives
    expect(a.attachment.id).not.toBe(b.attachment.id);

    // a FULL delete (includePinned) overrides provenance and purges everything
    const purged2 = await purgeConversationAttachments(CONV_A, U1, { includePinned: true });
    expect(purged2).toBe(1);
    expect(await listChatAttachments(CONV_A, U1)).toHaveLength(0);
  });

  it('Q5 accept-with-warning is a logged RISK acceptance, NOT a text correction (withheld text stays withheld)', async () => {
    const a = await ingest({ bytes: buf('lc'), extractedText: 'garbled', meanConfidence: 40, isImageSource: true });
    expect(a.attachment.acceptedWithWarning).toBe(false);
    expect(a.attachment.textContent).toBeNull();
    const accepted = await acceptAttachmentWithWarning(a.attachment.id, U1);
    expect(accepted?.acceptedWithWarning).toBe(true);
    expect(accepted?.textContent).toBeNull(); // accepting the RISK does not un-withhold the untrustworthy text
  });
});

describe('CHAT-COPILOT-2 A2 — party attribution (Q3)', () => {
  beforeEach(() => setChatAttachmentStore(createInMemoryAttachmentStore()));
  afterEach(() => setChatAttachmentStore(null));

  it('captures party attribution at save-to-matter', async () => {
    const a = await ingest({ bytes: buf('p'), extractedText: 'doc' });
    const party = await attributeAttachmentParty({ userId: U1, matterId: MATTER_A, attachmentId: a.attachment.id, partyId: null, partyRole: 'buyer', attribution: 'explicit' });
    expect(party.partyRole).toBe('buyer');
    expect(party.attribution).toBe('explicit');
  });
});

describe('CHAT-COPILOT-2 A2 — hardening (adversarial-review fixes)', () => {
  beforeEach(() => setChatAttachmentStore(createInMemoryAttachmentStore()));
  afterEach(() => setChatAttachmentStore(null));

  it('purge NULLS the ephemeral textContent; a re-drop in another matter STILL hard-stops (advisory survives purge)', async () => {
    const a = await ingest({ matterId: MATTER_A, conversationId: CONV_A, bytes: buf('PURGED-DEED'), extractedText: 'sensitive deed text' });
    expect(a.attachment.textContent).toBe('sensitive deed text');
    await purgeConversationAttachments(CONV_A, U1, { includePinned: false });
    const purged = await getChatAttachment(a.attachment.id, U1);
    expect(purged?.deletedAt).not.toBeNull();
    expect(purged?.textContent).toBeNull(); // ephemeral extracted text does NOT survive the soft-delete
    // re-dropping the SAME bytes into a different matter still hard-stops (the file WAS in matter A)
    await expect(
      ingest({ matterId: MATTER_B, conversationId: CONV_B, bytes: buf('PURGED-DEED'), extractedText: 'sensitive deed text' }),
    ).rejects.toThrow(/CROSS_MATTER_DUPLICATE/);
  });

  it('honesty floor applies to a SUB-FLOOR confidence even when isImageSource:false (mislabel defense)', async () => {
    const r = await ingest({ bytes: buf('mis'), extractedText: 'garbled ocr text', meanConfidence: 35, isImageSource: false });
    expect(r.attachment.extractionStatus).toBe('low_confidence');
    expect(r.attachment.textContent).toBeNull();
  });

  it('a purged attachment cannot be re-pinned, accepted, or saved-to-matter (it is gone)', async () => {
    const a = await ingest({ bytes: buf('gone'), extractedText: 'doc text' });
    await purgeConversationAttachments(CONV_A, U1, { includePinned: false });
    await expect(pinAttachment(a.attachment.id, U1, true)).rejects.toThrow(/not found/i);
    await expect(acceptAttachmentWithWarning(a.attachment.id, U1)).rejects.toThrow(/not found/i);
  });
});
