/**
 * NOTIFY-SUITE-1 N2 — deadline/tickler alert PRODUCER + the scanAlerts gating.
 *
 * The producer (scanAndEmitDeadlineAlerts) is the first real NOTIFY producer: for the owner it surfaces
 * NOT-YET-ALERTED ticklers whose fire date has arrived as in-app 'deadline' notifications, at most ONCE
 * (the tickler.notifiedAt cursor is the single-winner guard). DB-free — the deadline + notification query
 * layers are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { scanAndEmitDeadlineAlerts } from '../notifications/deadlineAlerts.js';
import * as deadlineQueries from '../db/queries/deadlines.js';
import * as notificationQueries from '../db/queries/notifications.js';
import * as auditQueries from '../db/queries/auditEvents.js';
import type { DeadlineClock } from '../deadline/clock.js';
import type { TicklerRow, MatterDeadlineRow } from '../../shared/schemas/deadline.js';
import type { NotificationRow } from '../../shared/schemas/notifications.js';

vi.mock('../db/queries/deadlines.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/deadlines.js')>();
  return { ...actual, listUninformedTicklers: vi.fn(), markTicklerNotified: vi.fn(), getMatterDeadlineById: vi.fn() };
});
vi.mock('../db/queries/notifications.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/notifications.js')>();
  return { ...actual, createNotification: vi.fn() };
});
vi.mock('../db/queries/auditEvents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/auditEvents.js')>();
  return { ...actual, recordAuditEvent: vi.fn().mockResolvedValue(undefined) };
});

const USER_ID = '11111111-1111-1111-1111-111111111111';
const MATTER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TODAY = '2026-06-19';
const CLOCK = { today: () => TODAY } as DeadlineClock;

function tickler(over: Partial<TicklerRow> & Pick<TicklerRow, 'id'>): TicklerRow {
  return {
    userId: USER_ID,
    matterDeadlineId: 'dddddddd-dddd-dddd-dddd-ddddddddddd1',
    leadDays: 30,
    fireAt: '2026-06-18',
    acknowledgedByUserId: null,
    acknowledgedAt: null,
    snoozedUntil: null,
    snoozeReason: null,
    notifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}
function deadline(over: Partial<MatterDeadlineRow> = {}): MatterDeadlineRow {
  return {
    matterId: MATTER_ID,
    family: 'closing_recording',
    description: 'Record the deed',
    status: 'active',
    computedDueDate: '2026-07-18',
    attorneyOverrideDate: null,
    // the remaining MatterDeadlineRow fields are not read by the producer:
    ...over,
  } as MatterDeadlineRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deadlineQueries.markTicklerNotified).mockResolvedValue(1);
  vi.mocked(auditQueries.recordAuditEvent).mockResolvedValue(undefined);
  vi.mocked(notificationQueries.createNotification).mockResolvedValue({} as NotificationRow);
});
afterEach(() => clearTelemetryBuffer());

describe('NOTIFY-SUITE-1 N2 — scanAndEmitDeadlineAlerts', () => {
  it('emits ONE deadline notification for a due, not-yet-alerted tickler of a LIVE deadline; stamps + audits', async () => {
    vi.mocked(deadlineQueries.listUninformedTicklers).mockResolvedValue([tickler({ id: 't1' })]);
    vi.mocked(deadlineQueries.getMatterDeadlineById).mockResolvedValue(deadline());

    const emitted = await scanAndEmitDeadlineAlerts(USER_ID, CLOCK);

    expect(emitted).toBe(1);
    expect(deadlineQueries.markTicklerNotified).toHaveBeenCalledWith('t1', USER_ID);
    expect(notificationQueries.createNotification).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(notificationQueries.createNotification).mock.calls[0]![0];
    expect(arg.type).toBe('deadline');
    expect(arg.matterId).toBe(MATTER_ID);
    expect(arg.title).toContain('Record the deed');
    expect(auditQueries.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditQueries.recordAuditEvent).mock.calls[0]![0].eventType).toBe('deadline_fired');
  });

  it('STAMPS but does NOT emit for a satisfied/waived deadline (no reminder needed; stop re-scanning)', async () => {
    vi.mocked(deadlineQueries.listUninformedTicklers).mockResolvedValue([tickler({ id: 't1' })]);
    vi.mocked(deadlineQueries.getMatterDeadlineById).mockResolvedValue(deadline({ status: 'satisfied' }));

    const emitted = await scanAndEmitDeadlineAlerts(USER_ID, CLOCK);

    expect(emitted).toBe(0);
    expect(deadlineQueries.markTicklerNotified).toHaveBeenCalledWith('t1', USER_ID); // stamped to stop re-scan
    expect(notificationQueries.createNotification).not.toHaveBeenCalled();
  });

  it('SKIPS a tickler still under an active snooze (left un-stamped so it re-checks after the snooze)', async () => {
    vi.mocked(deadlineQueries.listUninformedTicklers).mockResolvedValue([tickler({ id: 't1', snoozedUntil: '2026-06-25' })]);

    const emitted = await scanAndEmitDeadlineAlerts(USER_ID, CLOCK);

    expect(emitted).toBe(0);
    expect(deadlineQueries.getMatterDeadlineById).not.toHaveBeenCalled();
    expect(deadlineQueries.markTicklerNotified).not.toHaveBeenCalled(); // NOT stamped — re-checks later
    expect(notificationQueries.createNotification).not.toHaveBeenCalled();
  });

  it('single-winner: a stamp-loser (markTicklerNotified -> 0) emits NOTHING', async () => {
    vi.mocked(deadlineQueries.listUninformedTicklers).mockResolvedValue([tickler({ id: 't1' })]);
    vi.mocked(deadlineQueries.getMatterDeadlineById).mockResolvedValue(deadline());
    vi.mocked(deadlineQueries.markTicklerNotified).mockResolvedValue(0); // a concurrent scan already claimed it

    const emitted = await scanAndEmitDeadlineAlerts(USER_ID, CLOCK);

    expect(emitted).toBe(0);
    expect(notificationQueries.createNotification).not.toHaveBeenCalled();
  });

  it('best-effort: one tickler emit failing does NOT abort the scan (the other still emits)', async () => {
    vi.mocked(deadlineQueries.listUninformedTicklers).mockResolvedValue([
      tickler({ id: 't1', matterDeadlineId: 'dddddddd-dddd-dddd-dddd-ddddddddddd1' }),
      tickler({ id: 't2', matterDeadlineId: 'dddddddd-dddd-dddd-dddd-ddddddddddd2' }),
    ]);
    vi.mocked(deadlineQueries.getMatterDeadlineById).mockResolvedValue(deadline());
    vi.mocked(notificationQueries.createNotification)
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({} as NotificationRow);

    const emitted = await scanAndEmitDeadlineAlerts(USER_ID, CLOCK);

    expect(emitted).toBe(1); // t1 failed, t2 succeeded
    expect(notificationQueries.createNotification).toHaveBeenCalledTimes(2);
  });
});
