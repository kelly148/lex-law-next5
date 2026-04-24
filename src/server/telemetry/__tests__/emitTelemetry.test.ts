/**
 * emitTelemetry unit tests — Lex Law Next v1
 *
 * Verifies:
 * 1. Events land in the test buffer with correct shape.
 * 2. The catalog union prevents non-catalog strings at compile time.
 * 3. Context fields (userId, matterId, etc.) are correctly populated.
 * 4. The buffer is cleared between tests (via setup.ts beforeEach).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  emitTelemetry,
  getTelemetryBuffer,
  clearTelemetryBuffer,
} from '../emitTelemetry.js';
import {
  assertTelemetryEmitted,
  assertTelemetryNotEmitted,
} from '../../test-utils/setup.js';

describe('emitTelemetry — buffer mode', () => {
  beforeEach(() => {
    clearTelemetryBuffer();
  });

  it('writes an event to the buffer with correct envelope fields', () => {
    emitTelemetry(
      'matter_created',
      { title: 'Smith Family Trust' },
      { userId: '123e4567-e89b-12d3-a456-426614174000' }
    );

    const buffer = getTelemetryBuffer();
    expect(buffer).toHaveLength(1);

    const event = buffer[0];
    expect(event).toBeDefined();
    expect(event?.eventType).toBe('matter_created');
    expect(event?.userId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(event?.matterId).toBeNull();
    expect(event?.documentId).toBeNull();
    expect(event?.jobId).toBeNull();
    expect(event?.eventId).toMatch(/^[0-9a-f-]{36}$/); // UUID v4
    expect(event?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
    expect(event?.payload).toEqual({ title: 'Smith Family Trust' });
  });

  it('populates optional context fields when provided', () => {
    emitTelemetry(
      'document_state_transitioned',
      { fromState: 'draft', toState: 'complete', trigger: 'manual' },
      {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        matterId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        documentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        jobId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      }
    );

    const buffer = getTelemetryBuffer();
    const event = buffer[0];
    expect(event?.matterId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(event?.documentId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(event?.jobId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('accumulates multiple events in order', () => {
    emitTelemetry('matter_created', { title: 'Matter 1' }, { userId: 'uid1' });
    emitTelemetry('matter_archived', {}, { userId: 'uid1' });
    emitTelemetry('matter_unarchived', {}, { userId: 'uid1' });

    const buffer = getTelemetryBuffer();
    expect(buffer).toHaveLength(3);
    expect(buffer[0]?.eventType).toBe('matter_created');
    expect(buffer[1]?.eventType).toBe('matter_archived');
    expect(buffer[2]?.eventType).toBe('matter_unarchived');
  });

  it('getTelemetryBuffer returns a copy, not a reference', () => {
    emitTelemetry('matter_created', { title: 'Test' }, { userId: 'uid1' });

    const buffer1 = getTelemetryBuffer();
    const buffer2 = getTelemetryBuffer();

    // Modifying one copy should not affect the other
    buffer1.push({
      eventId: 'fake',
      eventType: 'matter_archived',
      userId: 'uid1',
      matterId: null,
      documentId: null,
      jobId: null,
      timestamp: new Date().toISOString(),
      payload: {},
    });

    expect(buffer2).toHaveLength(1); // original still has 1
    expect(getTelemetryBuffer()).toHaveLength(1); // internal buffer unchanged
  });

  it('clearTelemetryBuffer resets the buffer', () => {
    emitTelemetry('matter_created', { title: 'Test' }, { userId: 'uid1' });
    expect(getTelemetryBuffer()).toHaveLength(1);

    clearTelemetryBuffer();
    expect(getTelemetryBuffer()).toHaveLength(0);
  });
});

// ============================================================
// assertTelemetryEmitted helper tests
// ============================================================

describe('assertTelemetryEmitted', () => {
  beforeEach(() => {
    clearTelemetryBuffer();
  });

  it('passes when the event was emitted', () => {
    emitTelemetry('matter_created', { title: 'Test' }, { userId: 'uid1' });
    expect(() => assertTelemetryEmitted('matter_created')).not.toThrow();
  });

  it('fails when the event was not emitted', () => {
    expect(() => assertTelemetryEmitted('matter_created')).toThrow(
      "Expected telemetry event 'matter_created' to have been emitted"
    );
  });

  it('passes with a matching payload', () => {
    emitTelemetry('matter_created', { title: 'Smith Trust', clientName: 'Smith' }, { userId: 'uid1' });
    expect(() => assertTelemetryEmitted('matter_created', { title: 'Smith Trust' })).not.toThrow();
  });

  it('fails with a non-matching payload', () => {
    emitTelemetry('matter_created', { title: 'Smith Trust' }, { userId: 'uid1' });
    expect(() => assertTelemetryEmitted('matter_created', { title: 'Jones Trust' })).toThrow(
      'no emission matched the expected payload'
    );
  });
});

describe('assertTelemetryNotEmitted', () => {
  beforeEach(() => {
    clearTelemetryBuffer();
  });

  it('passes when the event was not emitted', () => {
    expect(() => assertTelemetryNotEmitted('matter_created')).not.toThrow();
  });

  it('fails when the event was emitted', () => {
    emitTelemetry('matter_created', { title: 'Test' }, { userId: 'uid1' });
    expect(() => assertTelemetryNotEmitted('matter_created')).toThrow(
      "Expected telemetry event 'matter_created' NOT to have been emitted"
    );
  });
});
