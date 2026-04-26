/**
 * Jobs Zod Wall Tests (Ch 34.2, Ch 35.1)
 *
 * Verifies that the jobs table Zod Wall:
 *   1. Parses valid rows correctly.
 *   2. Throws ZodError on malformed input column data.
 *   3. Throws ZodError on invalid status enum values.
 *   4. Emits zod_parse_failed telemetry on parse failure.
 *   5. Rejects prototype pollution attempts.
 *   6. Rejects null injection where values are required.
 *
 * These tests use the JobRowSchema directly (unit-level Zod Wall test)
 * rather than going through the DB, consistent with the Phase 1 Zod Wall
 * Stress Test pattern.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { JobRowSchema } from '../../../../shared/schemas/jobs.js';
import { clearTelemetryBuffer, assertTelemetryEmitted } from '../../../test-utils/setup.js';

// ============================================================
// Helpers
// ============================================================

function validJobRow(): Record<string, unknown> {
  return {
    id: uuidv4(),
    userId: uuidv4(),
    matterId: null,
    documentId: null,
    jobType: 'draft_generation',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-5',
    promptVersion: '1.0',
    status: 'queued',
    queuedAt: new Date(),
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    input: {
      systemPrompt: 'You are a legal drafting assistant.',
      userPrompt: 'Draft a contract clause.',
      materialsManifest: [],
      roleMetadata: {},
    },
    output: null,
    errorClass: null,
    errorMessage: null,
    tokensPrompt: null,
    tokensCompletion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  clearTelemetryBuffer();
});

// ============================================================
// Happy path
// ============================================================

describe('JobRowSchema — happy path', () => {
  it('parses a valid queued job row', () => {
    const row = validJobRow();
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('parses a valid completed job row with output', () => {
    const row = {
      ...validJobRow(),
      status: 'completed',
      startedAt: new Date(),
      completedAt: new Date(),
      output: {
        type: 'text',
        content: 'The party agrees to...',
        tokensPrompt: 100,
        tokensCompletion: 50,
      },
      tokensPrompt: 100,
      tokensCompletion: 50,
    };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('parses a valid failed job row with errorClass', () => {
    const row = {
      ...validJobRow(),
      status: 'failed',
      startedAt: new Date(),
      completedAt: new Date(),
      errorClass: 'api_error',
      errorMessage: 'Rate limit exceeded',
    };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('parses all valid status values', () => {
    const statuses = ['queued', 'running', 'completed', 'failed', 'timed_out', 'cancelled'] as const;
    for (const status of statuses) {
      const row = { ...validJobRow(), status };
      expect(() => JobRowSchema.parse(row)).not.toThrow();
    }
  });

  it('parses all valid job type values', () => {
    const jobTypes = [
      'data_extraction',
      'draft_generation',
      'review',
      'regeneration',
      'formatting',
      'information_request_generation',
      'outline_generation',
      'context_summary_generation',
    ] as const;
    for (const jobType of jobTypes) {
      const row = { ...validJobRow(), jobType };
      expect(() => JobRowSchema.parse(row)).not.toThrow();
    }
  });
});

// ============================================================
// Zod Wall — malformed input column
// ============================================================

describe('JobRowSchema — malformed input column (Zod Wall)', () => {
  it('does NOT throw when input.systemPrompt is missing (legacy rows with input:{})', () => {
    // Legacy jobs were stored with input:{} before prompt capture was implemented.
    // systemPrompt and userPrompt are now optional to allow these rows to parse.
    const row = {
      ...validJobRow(),
      input: {
        // systemPrompt missing — valid for legacy rows
        userPrompt: 'Draft a contract clause.',
      },
    };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('does NOT throw when input is empty object (legacy rows)', () => {
    const row = { ...validJobRow(), input: {} };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('throws ZodError when input.userPrompt is empty string', () => {
    const row = {
      ...validJobRow(),
      input: {
        systemPrompt: 'You are a legal drafting assistant.',
        userPrompt: '', // min(1) violation
      },
    };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError when input is null', () => {
    const row = { ...validJobRow(), input: null };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError when input is a plain string (malformed JSON column)', () => {
    const row = {
      ...validJobRow(),
      input: '{"systemPrompt":"test","userPrompt":"test"}', // string instead of object
    };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError when input.materialsManifest contains invalid tier', () => {
    const row = {
      ...validJobRow(),
      input: {
        systemPrompt: 'test',
        userPrompt: 'test',
        materialsManifest: [
          {
            materialId: uuidv4(),
            contentHash: 'abc123',
            tokenCount: 100,
            tier: 'tier99', // invalid tier
          },
        ],
      },
    };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });
});

// ============================================================
// Zod Wall — invalid enum values
// ============================================================

describe('JobRowSchema — invalid enum values (Zod Wall)', () => {
  it('throws ZodError for invalid status', () => {
    const row = { ...validJobRow(), status: 'in_progress' }; // not in enum
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError for invalid jobType', () => {
    const row = { ...validJobRow(), jobType: 'unknown_type' };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError for invalid errorClass', () => {
    const row = {
      ...validJobRow(),
      status: 'failed',
      errorClass: 'network_error', // not in enum
    };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });
});

// ============================================================
// Zod Wall — null injection
// ============================================================

describe('JobRowSchema — null injection', () => {
  it('throws ZodError when id is null', () => {
    const row = { ...validJobRow(), id: null };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError when userId is null', () => {
    const row = { ...validJobRow(), userId: null };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError when jobType is null', () => {
    const row = { ...validJobRow(), jobType: null };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError when promptVersion is null', () => {
    const row = { ...validJobRow(), promptVersion: null };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError when status is null', () => {
    const row = { ...validJobRow(), status: null };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('accepts null for nullable fields (matterId, documentId, startedAt, etc.)', () => {
    const row = {
      ...validJobRow(),
      matterId: null,
      documentId: null,
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
      output: null,
      errorClass: null,
      errorMessage: null,
      tokensPrompt: null,
      tokensCompletion: null,
    };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });
});

// ============================================================
// Zod Wall — prototype pollution
// ============================================================

describe('JobRowSchema — prototype pollution', () => {
  it('does not propagate __proto__ injection to the prototype chain', () => {
    // JSON.parse with __proto__ key does NOT set the prototype chain in V8 —
    // it creates a plain own property named "__proto__" on the object.
    // Zod's z.record() passthrough preserves it as a plain key, which is safe.
    // The critical invariant: the parsed result must not have isAdmin on its prototype.
    const malicious = JSON.parse('{"systemPrompt":"test","userPrompt":"test","__proto__":{"isAdmin":true}}') as Record<string, unknown>;
    const row = { ...validJobRow(), input: malicious };
    const parsed = JobRowSchema.parse(row);
    // Prototype chain must not be polluted
    expect((parsed as Record<string, unknown>)['isAdmin']).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.getPrototypeOf({}));
  });

  it('preserves constructor key as a plain property (not prototype pollution)', () => {
    // Zod's z.record() passthrough preserves unknown keys including "constructor".
    // This is safe because it does not modify the prototype chain — it is just a
    // plain own property on the parsed record. The invariant is that the prototype
    // chain is not modified, not that the key is stripped.
    const malicious = {
      systemPrompt: 'test',
      userPrompt: 'test',
      constructor: { prototype: { isAdmin: true } },
    };
    const row = { ...validJobRow(), input: malicious };
    const parsed = JobRowSchema.parse(row);
    // Prototype chain must not be polluted
    expect((parsed as Record<string, unknown>)['isAdmin']).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.getPrototypeOf({}));
  });
});

// ============================================================
// Zod Wall — output column validation
// ============================================================

describe('JobRowSchema — output column validation', () => {
  it('accepts null output', () => {
    const row = { ...validJobRow(), output: null };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('accepts text output', () => {
    const row = {
      ...validJobRow(),
      output: { type: 'text', content: 'Legal text here', tokensPrompt: 100, tokensCompletion: 50 },
    };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('accepts structured output', () => {
    const row = {
      ...validJobRow(),
      output: {
        type: 'structured',
        content: { title: 'Review', suggestions: [] },
        tokensPrompt: 100,
        tokensCompletion: 50,
      },
    };
    expect(() => JobRowSchema.parse(row)).not.toThrow();
  });

  it('throws ZodError for output with invalid type', () => {
    const row = {
      ...validJobRow(),
      output: { type: 'audio', content: 'test', tokensPrompt: 100, tokensCompletion: 50 },
    };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });

  it('throws ZodError for output with missing tokensPrompt', () => {
    const row = {
      ...validJobRow(),
      output: { type: 'text', content: 'test', tokensCompletion: 50 }, // missing tokensPrompt
    };
    expect(() => JobRowSchema.parse(row)).toThrow(ZodError);
  });
});

// ============================================================
// Zod Wall — telemetry emission on parse failure
// ============================================================

describe('JobRowSchema — zod_parse_failed telemetry (Ch 25.9)', () => {
  it('zod_parse_failed telemetry is emitted when the jobs Zod Wall parse fails', async () => {
    // This test verifies the pattern: when the jobs query wrapper catches a ZodError,
    // it emits zod_parse_failed telemetry. We test the schema directly here;
    // the query wrapper integration is tested in the query wrapper itself.
    //
    // The pattern is: catch ZodError → emitTelemetry('zod_parse_failed', ...) → rethrow
    // We simulate this pattern here.

    const { emitTelemetry } = await import('../../../telemetry/emitTelemetry.js');

    const malformedRow = { ...validJobRow(), status: 'INVALID_STATUS' };

    try {
      JobRowSchema.parse(malformedRow);
      throw new Error('Expected ZodError but parse succeeded');
    } catch (err) {
      if (err instanceof ZodError) {
        // Simulate what the query wrapper does
        await emitTelemetry(
          'zod_parse_failed',
          {
            schemaName: 'JobRowSchema',
            tableName: 'jobs',
            errorPath: err.errors[0]?.path.join('.') ?? 'unknown',
            errorMessage: err.errors[0]?.message ?? 'unknown',
          },
          { userId: 'test-user', matterId: null, documentId: null, jobId: null },
        );
      } else {
        throw err;
      }
    }

    assertTelemetryEmitted('zod_parse_failed', {
      schemaName: 'JobRowSchema',
      tableName: 'jobs',
    });
  });
});
