/**
 * Phase 7 Orphan Procedure Tests
 *
 * Covers the nontrivial orphan procedures that lack direct UI callers but
 * represent completed server-side workflows or future UI wirings.
 *
 * 1. outline.reopenForEdit (approved -> draft)
 * 2. outline.skip (draft/no-outline -> skipped)
 * 3. reference.add (creates sibling reference with referencedVersionId snapshot)
 * 4. reference.remove (removes reference)
 * 5. reference.listInbound (returns inbound references)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearTelemetryBuffer, assertTelemetryEmitted } from '../test-utils/setup.js';
import * as outlineQueries from '../db/queries/phase4b.js';
import * as referenceQueries from '../db/queries/references.js';
import * as documentQueries from '../db/queries/documents.js';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import type { DocumentOutlineRow } from '../../shared/schemas/phase4b.js';
import type { DocumentReferenceRow, DocumentRow } from '../../shared/schemas/matters.js';

// Mock the query layer
vi.mock('../db/queries/phase4b.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/phase4b.js')>();
  return {
    ...actual,
    getOutlineById: vi.fn(),
    getOutlineForDocument: vi.fn(),
    updateDocumentOutline: vi.fn(),
    insertDocumentOutline: vi.fn(),
  };
});

vi.mock('../db/queries/references.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/references.js')>();
  return {
    ...actual,
    getReferenceById: vi.fn(),
    listReferencesForDocument: vi.fn(),
    listInboundReferences: vi.fn(),
    insertReference: vi.fn(),
    deleteReference: vi.fn(),
  };
});

vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return {
    ...actual,
    getDocumentById: vi.fn(),
  };
});

// Create a caller for the tests
const createCaller = (userId: string) => {
  return appRouter.createCaller({
  req: {} as Request,
  res: {} as Response,
    userId,
  });
};

const USER_ID = '00000000-0000-0000-0000-000000000001';
const caller = createCaller(USER_ID);

describe('Phase 7 Orphan Procedures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearTelemetryBuffer();
  });

  afterEach(() => {
    clearTelemetryBuffer();
  });

  // ============================================================
  // 1. outline.reopenForEdit
  // ============================================================
  describe('outline.reopenForEdit', () => {
    it('transitions approved outline back to draft', async () => {
      const mockOutline: DocumentOutlineRow = {
        id: '00000000-0000-0000-0000-000000000003',
        userId: USER_ID,
        documentId: '00000000-0000-0000-0000-000000000001',
        status: 'approved',
        sections: [],
        generatedByJobId: null,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(outlineQueries.getOutlineById).mockResolvedValue(mockOutline);
      vi.mocked(outlineQueries.updateDocumentOutline).mockResolvedValue();

      const result = await caller.outline.reopenForEdit({ outlineId: '00000000-0000-0000-0000-000000000003' });
      
      expect(result.success).toBe(true);
      expect(outlineQueries.updateDocumentOutline).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000003',
        USER_ID,
        { status: 'draft', approvedAt: null }
      );
      assertTelemetryEmitted('outline_reopened', { outlineId: '00000000-0000-0000-0000-000000000003' });
    });

    it('rejects outline that is not in approved state', async () => {
      const mockOutline: DocumentOutlineRow = {
        id: '00000000-0000-0000-0000-000000000003',
        userId: USER_ID,
        documentId: '00000000-0000-0000-0000-000000000001',
        status: 'draft', // Not approved
        sections: [],
        generatedByJobId: null,
        approvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(outlineQueries.getOutlineById).mockResolvedValue(mockOutline);

      await expect(caller.outline.reopenForEdit({ outlineId: '00000000-0000-0000-0000-000000000003' }))
        .rejects.toThrowError(/WRONG_STATUS: outline.reopenForEdit requires status='approved'/);
    });

    it('rejects if outline not found (or not owned)', async () => {
      vi.mocked(outlineQueries.getOutlineById).mockResolvedValue(null);

      await expect(caller.outline.reopenForEdit({ outlineId: '00000000-0000-0000-0000-000000000003' }))
        .rejects.toThrowError(/Outline not found/);
    });
  });

  // ============================================================
  // 2. outline.skip
  // ============================================================
  describe('outline.skip', () => {
    const mockDoc: DocumentRow = {
      id: '00000000-0000-0000-0000-000000000001',
      userId: USER_ID,
      matterId: '00000000-0000-0000-0000-000000000005',
      title: 'Doc',
      documentType: 'contract',
      customTypeLabel: null,
      draftingMode: 'template',
      templateBindingStatus: 'bound',
      templateVersionId: null,
      templateSnapshot: null,
      variableMap: null,
      workflowState: 'drafting',
      currentVersionId: null,
      officialSubstantiveVersionNumber: null,
      officialFinalVersionNumber: null,
      completedAt: null,
      archivedAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('marks existing draft outline as skipped', async () => {
      const mockOutline: DocumentOutlineRow = {
        id: '00000000-0000-0000-0000-000000000003',
        userId: USER_ID,
        documentId: '00000000-0000-0000-0000-000000000001',
        status: 'draft',
        sections: [],
        generatedByJobId: null,
        approvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(documentQueries.getDocumentById).mockResolvedValue(mockDoc);
      vi.mocked(outlineQueries.getOutlineForDocument).mockResolvedValue(mockOutline);
      vi.mocked(outlineQueries.updateDocumentOutline).mockResolvedValue();

      const result = await caller.outline.skip({ documentId: '00000000-0000-0000-0000-000000000001' });
      
      expect(result.success).toBe(true);
      expect(outlineQueries.updateDocumentOutline).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000003',
        USER_ID,
        { status: 'skipped' }
      );
      assertTelemetryEmitted('outline_skipped', { documentId: '00000000-0000-0000-0000-000000000001' });
    });

    it('creates a new skipped outline if none exists', async () => {
      vi.mocked(documentQueries.getDocumentById).mockResolvedValue(mockDoc);
      vi.mocked(outlineQueries.getOutlineForDocument).mockResolvedValue(null);
      vi.mocked(outlineQueries.insertDocumentOutline).mockResolvedValue('new-outline-id');
      vi.mocked(outlineQueries.updateDocumentOutline).mockResolvedValue();

      const result = await caller.outline.skip({ documentId: '00000000-0000-0000-0000-000000000001' });
      
      expect(result.success).toBe(true);
      expect(outlineQueries.insertDocumentOutline).toHaveBeenCalledWith({
        userId: USER_ID,
        documentId: '00000000-0000-0000-0000-000000000001',
      });
      expect(outlineQueries.updateDocumentOutline).toHaveBeenCalledWith(
        'new-outline-id',
        USER_ID,
        { status: 'skipped' }
      );
    });

    it('rejects if outline is already approved', async () => {
      const mockOutline: DocumentOutlineRow = {
        id: '00000000-0000-0000-0000-000000000003',
        userId: USER_ID,
        documentId: '00000000-0000-0000-0000-000000000001',
        status: 'approved',
        sections: [],
        generatedByJobId: null,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(documentQueries.getDocumentById).mockResolvedValue(mockDoc);
      vi.mocked(outlineQueries.getOutlineForDocument).mockResolvedValue(mockOutline);

      await expect(caller.outline.skip({ documentId: '00000000-0000-0000-0000-000000000001' }))
        .rejects.toThrowError(/OUTLINE_APPROVED: cannot skip an already-approved outline/);
    });
  });

  // ============================================================
  // 3. reference.add
  // ============================================================
  describe('reference.add', () => {
    const mockSourceDoc: DocumentRow = {
      id: '00000000-0000-0000-0000-000000000001',
      userId: USER_ID,
      matterId: '00000000-0000-0000-0000-000000000005',
      title: 'Source Doc',
      documentType: 'contract',
      customTypeLabel: null,
      draftingMode: 'template',
      templateBindingStatus: 'bound',
      templateVersionId: null,
      templateSnapshot: null,
      variableMap: null,
      workflowState: 'drafting',
      currentVersionId: null,
      officialSubstantiveVersionNumber: null,
      officialFinalVersionNumber: null,
      completedAt: null,
      archivedAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockRefDoc: DocumentRow = {
      ...mockSourceDoc,
      id: '00000000-0000-0000-0000-000000000002',
      title: 'Referenced Doc',
      currentVersionId: '00000000-0000-0000-0000-000000000006', // Required for reference
    };

    it('creates a sibling reference with referencedVersionId snapshot', async () => {
      vi.mocked(documentQueries.getDocumentById)
        .mockImplementation(async (id) => {
          if (id === '00000000-0000-0000-0000-000000000001') return mockSourceDoc;
          if (id === '00000000-0000-0000-0000-000000000002') return mockRefDoc;
          return null;
        });
      
      vi.mocked(referenceQueries.listReferencesForDocument).mockResolvedValue([]);
      
      const mockInsertedRef: DocumentReferenceRow = {
        id: '00000000-0000-0000-0000-000000000004',
        userId: USER_ID,
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
        referencedVersionId: '00000000-0000-0000-0000-000000000006',
        stalenessAcknowledgedAt: null,
        createdAt: new Date(),
      };
      vi.mocked(referenceQueries.insertReference).mockResolvedValue(mockInsertedRef);

      const result = await caller.reference.add({
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
      });
      
      expect(result).toEqual(mockInsertedRef);
      expect(referenceQueries.insertReference).toHaveBeenCalledWith(expect.objectContaining({
        userId: USER_ID,
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
        referencedVersionId: '00000000-0000-0000-0000-000000000006',
      }));
      assertTelemetryEmitted('reference_added', {
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
        referencedVersionId: '00000000-0000-0000-0000-000000000006',
      });
    });

    it('rejects self-reference', async () => {
      await expect(caller.reference.add({
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000001',
      })).rejects.toThrowError(/SELF_REFERENCE_NOT_ALLOWED/);
    });

    it('rejects non-owned source document', async () => {
      vi.mocked(documentQueries.getDocumentById).mockResolvedValue(null);
      
      await expect(caller.reference.add({
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
      })).rejects.toThrowError(/Source document not found/);
    });

    it('rejects referenced document with no version', async () => {
      const docNoVersion = { ...mockRefDoc, currentVersionId: null };
      
      vi.mocked(documentQueries.getDocumentById)
        .mockImplementation(async (id) => {
          if (id === '00000000-0000-0000-0000-000000000001') return mockSourceDoc;
          if (id === '00000000-0000-0000-0000-000000000002') return docNoVersion;
          return null;
        });
        
      await expect(caller.reference.add({
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
      })).rejects.toThrowError(/REFERENCED_DOCUMENT_HAS_NO_VERSION/);
    });

    it('rejects duplicate reference', async () => {
      vi.mocked(documentQueries.getDocumentById)
        .mockImplementation(async (id) => {
          if (id === '00000000-0000-0000-0000-000000000001') return mockSourceDoc;
          if (id === '00000000-0000-0000-0000-000000000002') return mockRefDoc;
          return null;
        });
      
      // Return an existing reference
      vi.mocked(referenceQueries.listReferencesForDocument).mockResolvedValue([{
        id: '00000000-0000-0000-0000-000000000004',
        userId: USER_ID,
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
        referencedVersionId: '00000000-0000-0000-0000-000000000007',
        stalenessAcknowledgedAt: null,
        createdAt: new Date(),
      }]);
      
      await expect(caller.reference.add({
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
      })).rejects.toThrowError(/REFERENCE_ALREADY_EXISTS/);
    });
  });

  // ============================================================
  // 4. reference.remove
  // ============================================================
  describe('reference.remove', () => {
    it('removes the reference and emits telemetry', async () => {
      const mockRef: DocumentReferenceRow = {
        id: '00000000-0000-0000-0000-000000000004',
        userId: USER_ID,
        sourceDocumentId: '00000000-0000-0000-0000-000000000001',
        referencedDocumentId: '00000000-0000-0000-0000-000000000002',
        referencedVersionId: '00000000-0000-0000-0000-000000000006',
        stalenessAcknowledgedAt: null,
        createdAt: new Date(),
      };
      
      vi.mocked(referenceQueries.getReferenceById).mockResolvedValue(mockRef);
      vi.mocked(referenceQueries.deleteReference).mockResolvedValue();
      
      // Mock source doc for telemetry matterId lookup
      vi.mocked(documentQueries.getDocumentById).mockResolvedValue({
        matterId: '00000000-0000-0000-0000-000000000005',
      } as DocumentRow);

      const result = await caller.reference.remove({ referenceId: '00000000-0000-0000-0000-000000000004' });
      
      expect(result.deleted).toBe(true);
      expect(referenceQueries.deleteReference).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000004', USER_ID);
      assertTelemetryEmitted('reference_removed', { referenceId: '00000000-0000-0000-0000-000000000004' });
    });

    it('rejects non-owned reference', async () => {
      vi.mocked(referenceQueries.getReferenceById).mockResolvedValue(null);

      await expect(caller.reference.remove({ referenceId: '00000000-0000-0000-0000-000000000004' }))
        .rejects.toThrowError(/Reference not found/);
    });
  });

  // ============================================================
  // 5. reference.listInbound
  // ============================================================
  describe('reference.listInbound', () => {
    it('returns inbound references for a document scoped by userId', async () => {
      const mockRefs: DocumentReferenceRow[] = [
        {
          id: '00000000-0000-0000-0000-000000000004',
          userId: USER_ID,
          sourceDocumentId: '00000000-0000-0000-0000-000000000001',
          referencedDocumentId: '00000000-0000-0000-0000-000000000002', // the target
          referencedVersionId: '00000000-0000-0000-0000-000000000006',
          stalenessAcknowledgedAt: null,
          createdAt: new Date(),
        }
      ];
      
      vi.mocked(referenceQueries.listInboundReferences).mockResolvedValue(mockRefs);

      const result = await caller.reference.listInbound({ referencedDocumentId: '00000000-0000-0000-0000-000000000002' });
      
      expect(result).toEqual(mockRefs);
      expect(referenceQueries.listInboundReferences).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000002', USER_ID);
    });
  });
});
