/**
 * Closure-package tRPC procedures — FOLD-DRAFT-1 / package (Increment 2: rules + read/record API).
 *
 * Records + reads the items of a matter's closing package(s) and computes an ADVISORY completeness
 * check. Recording is an explicit ATTORNEY act (recordedBy='attorney'), owner-checked + audited;
 * the itemType<->refId pairing is validated. DEFAULT-SAFE: getClosureCheck reports what required
 * items are still missing — it NEVER finalizes, sends, or locks the package (sending is
 * FOLD-SEND-1). The attorney is the decision-maker. The UI is Inc3.
 *
 * userId is always ctx.userId (Ch 35.2); ownership flows through getMatterById + the owner-scoped
 * query wrappers.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getMatterById } from '../db/queries/matters.js';
import {
  insertClosurePackageItem,
  listClosurePackageItemsForMatter,
  listClosurePackageItemsForPackage,
} from '../db/queries/closurePackage.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { validateClosurePackageItemRef } from '../draft/closurePackageRules.js';
import { computeClosure, type ClosureCheckResult } from '../draft/closureCheck.js';

const ITEM_TYPE_ENUM = z.enum(['document', 'material', 'source', 'checklist']);
const REQUIREMENT_ENUM = z.enum(['required', 'optional']);
const STATUS_ENUM = z.enum(['present', 'missing', 'not_applicable']);

export const closurePackageRouter = router({
  // ============================================================
  // closurePackage.listForMatter / listForPackage — READ (owner-scoped)
  // ============================================================
  listForMatter: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(({ ctx, input }) => listClosurePackageItemsForMatter(input.matterId, ctx.userId)),

  listForPackage: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), packageName: z.string().min(1).max(256) }))
    .query(({ ctx, input }) => listClosurePackageItemsForPackage(input.matterId, input.packageName, ctx.userId)),

  // ============================================================
  // closurePackage.record — capture (explicit attorney act; owner-checked; invariant-validated; audited)
  // ============================================================
  record: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        packageName: z.string().min(1).max(256),
        itemType: ITEM_TYPE_ENUM,
        refId: z.string().max(64).nullable().optional(),
        label: z.string().min(1).max(512),
        requirement: REQUIREMENT_ENUM,
        status: STATUS_ENUM,
        notes: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      const refId = input.refId ?? null;
      const valid = validateClosurePackageItemRef(input.itemType, refId);
      if (!valid.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: valid.reason ?? 'Invalid package item ref' });
      }

      const row = await insertClosurePackageItem({
        userId: ctx.userId,
        matterId: input.matterId,
        packageName: input.packageName,
        itemType: input.itemType,
        refId,
        label: input.label,
        requirement: input.requirement,
        status: input.status,
        recordedBy: 'attorney',
        notes: input.notes ?? null,
      });

      await recordAuditEvent({
        userId: ctx.userId,
        matterId: input.matterId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Recorded closure-package item "${input.label}" in "${input.packageName}" (${input.itemType})`,
        targetType: 'closure_package_item',
        targetId: row.id,
        action: 'record_closure_package_item',
        scope: 'matter',
        payload: { packageName: input.packageName, itemType: input.itemType, requirement: input.requirement, status: input.status },
      });

      return row;
    }),

  // ============================================================
  // closurePackage.getClosureCheck — READ: advisory completeness for one named package.
  // DEFAULT-SAFE: reports missing required items only; never finalizes/sends/locks.
  // ============================================================
  getClosureCheck: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), packageName: z.string().min(1).max(256) }))
    .query(async ({ ctx, input }): Promise<ClosureCheckResult> => {
      const items = await listClosurePackageItemsForPackage(input.matterId, input.packageName, ctx.userId);
      return computeClosure(
        items.map((i) => ({ id: i.id, label: i.label, requirement: i.requirement, status: i.status })),
      );
    }),
});
