/**
 * NOTIFY-SUITE-1 N2 — deadline/tickler alert PRODUCER.
 *
 * The first real notification producer (FOLD-NOTIFY-1 deferred producers; N2 lands this one). For the
 * current owner, it scans NOT-YET-ALERTED ticklers whose effective fire date has arrived and surfaces each
 * — at most ONCE — as an in-app 'deadline' notification (which the bell + the per-matter "deadline
 * approaching" badge read). Pure read over the PM-1 deadline engine + write to the NOTIFY store; it adds NO
 * new deadline computation and NEVER auto-acts (informational only — the attorney acts).
 *
 * IDEMPOTENCE / single-winner: tickler.notifiedAt is the cursor. markTicklerNotified is a conditional UPDATE
 * (notifiedAt IS NULL) that returns the rows IT transitioned, so a concurrent scan can claim each tickler at
 * most once — we STAMP before we emit, so a stamp-loser (or a satisfied/waived deadline) never produces a
 * second alert. A best-effort emit failure after a successful stamp drops at most one alert (the deadline
 * still shows in the deadline panel); duplicate spam is the worse failure, so stamp-first is deliberate.
 *
 * GATING: the caller (deadline.scanAlerts) gates on DEADLINE_ENGINE_ENABLED + NOTIFICATIONS_ENABLED (both
 * default OFF). userId is always the caller's (owner-scoped throughout the query layer).
 */
import { createNotification } from '../db/queries/notifications.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import {
  listUninformedTicklers,
  markTicklerNotified,
  getMatterDeadlineById,
  effectiveDueDate,
} from '../db/queries/deadlines.js';
import { systemClock, type DeadlineClock } from '../deadline/clock.js';

/**
 * Scan + emit the owner's approaching-deadline alerts. Returns the number of in-app notifications emitted.
 * Best-effort per tickler (one failure never aborts the scan). Deterministic "today" via the injected clock.
 */
export async function scanAndEmitDeadlineAlerts(
  userId: string,
  clock: DeadlineClock = systemClock,
): Promise<number> {
  const today = clock.today();
  const due = await listUninformedTicklers(userId, today); // notifiedAt IS NULL AND fireAt <= today
  let emitted = 0;

  for (const t of due) {
    try {
      // A tickler still under an active snooze is left un-stamped so it re-checks once the snooze expires.
      if (t.snoozedUntil && t.snoozedUntil > today) continue;

      const deadline = await getMatterDeadlineById(t.matterDeadlineId, userId);
      if (!deadline) continue;

      // A disposed (satisfied/waived) deadline needs no reminder — STAMP it so its tickler stops re-scanning,
      // but emit nothing.
      if (deadline.status === 'satisfied' || deadline.status === 'waived') {
        await markTicklerNotified(t.id, userId);
        continue;
      }

      // Claim the tickler FIRST (single-winner) — a concurrent scan that loses the stamp emits nothing.
      const stamped = await markTicklerNotified(t.id, userId);
      if (stamped === 0) continue;

      await createNotification({
        userId,
        matterId: deadline.matterId,
        type: 'deadline',
        title: `Deadline approaching: ${deadline.description}`,
        body: `Due ${effectiveDueDate(deadline) ?? t.fireAt} (${deadline.family}). Reminder T-${t.leadDays} days.`,
      });

      // Audit the SYSTEM firing (distinct from an attorney act) — best-effort (never throws).
      await recordAuditEvent({
        userId,
        matterId: deadline.matterId,
        eventType: 'deadline_fired',
        actor: 'system',
        summary: `Surfaced approaching deadline "${deadline.description}" (T-${t.leadDays}) as an in-app alert`,
        targetType: 'tickler',
        targetId: t.id,
        action: 'notify_deadline_approaching',
      });
      emitted += 1;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[deadline-alerts] failed to emit alert for tickler ${t.id}:`, e);
    }
  }
  return emitted;
}
