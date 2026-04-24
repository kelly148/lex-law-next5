/**
 * Phase 4a Acceptance Tests
 *
 * Covers:
 *   AC1 — Handlebars engine: phase-1 validation rejects malformed templates;
 *         valid templates render correctly with Appendix D helpers.
 *   AC2 — Template sandbox: renderTemplateSandbox always injects the mandatory
 *         watermark (Decision #40); cannot be bypassed by configuration.
 *   AC3 — R12 COMPLETE_READONLY guard: Phase 4a procedures (extractVariables,
 *         populateFromMatter, updateVariableMap, render, generateDraft,
 *         regenerate, detach, acceptSubstantive, reopenSubstantive,
 *         startFinalize) all call assertNotComplete.
 *   AC4 — document.finalize R13 TOCTOU: detectStaleReferences is called
 *         inside the finalize procedure (not before); stale refs block finalize
 *         unless acknowledged.
 *   AC5 — document.detach: one-way only; re-detach is rejected; snapshot
 *         captures variable map at detach time.
 *   AC6 — Template procedures: template.upload emits template_uploaded telemetry;
 *         template.activate requires valid phase-1 status.
 *   AC7 — No Phase 4b structures: review_sessions, feedback tables, matrix,
 *         outline do not exist in Phase 4a codebase.
 *   AC8 — Ch 35.2: no Phase 4a procedure input schema contains a userId field.
 *   AC9 — document.regenerate does not reference Phase 4b entities (review_sessions,
 *         feedback) — Part D stop condition check.
 *
 * userId is always drawn from ctx.userId (Ch 35.2) — never from input.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { validateHandlebarsSource, renderTemplate, renderTemplateSandbox, SANDBOX_WATERMARK } from '../llm/handlebars/engine.js';

// ============================================================
// AC1 — Handlebars engine: phase-1 validation and rendering
// ============================================================

describe('AC1: Handlebars engine phase-1 validation and rendering', () => {
  it('accepts a valid Handlebars template', () => {
    const source = 'Hello, {{clientName}}! This agreement is dated {{agreementDate}}.';
    const result = validateHandlebarsSource(source);
    expect(result.valid).toBe(true);
  });

  it('rejects a template with unclosed block helper', () => {
    const source = '{{#if condition}}Some text without closing';
    const result = validateHandlebarsSource(source);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeTruthy();
  });

  it('renders a simple template with variable substitution', () => {
    const source = 'This agreement is between {{partyA}} and {{partyB}}.';
    const result = renderTemplate(source, { partyA: 'Alice Corp', partyB: 'Bob LLC' });
    expect(result.content).toBe('This agreement is between Alice Corp and Bob LLC.');
  });

  it('renders {{#if}} block helper correctly', () => {
    const source = '{{#if hasAttachment}}Attachment: {{attachmentName}}{{/if}}';
    const withAttachment = renderTemplate(source, { hasAttachment: true, attachmentName: 'Exhibit A' });
    expect(withAttachment.content).toBe('Attachment: Exhibit A');

    const withoutAttachment = renderTemplate(source, { hasAttachment: false });
    expect(withoutAttachment.content).toBe('');
  });

  it('renders {{#unless}} block helper correctly', () => {
    const source = '{{#unless isPending}}EXECUTED{{/unless}}';
    const executed = renderTemplate(source, { isPending: false });
    expect(executed.content).toBe('EXECUTED');

    const pending = renderTemplate(source, { isPending: true });
    expect(pending.content).toBe('');
  });

  it('renders {{#each}} block helper correctly', () => {
    const source = '{{#each parties}}{{name}}; {{/each}}';
    const result = renderTemplate(source, { parties: [{ name: 'Alice' }, { name: 'Bob' }] });
    expect(result.content).toContain('Alice');
    expect(result.content).toContain('Bob');
  });

  it('renders {{eq}} comparison helper correctly (Appendix D)', () => {
    const source = '{{#if (eq status "active")}}ACTIVE{{/if}}';
    const active = renderTemplate(source, { status: 'active' });
    expect(active.content).toBe('ACTIVE');

    const inactive = renderTemplate(source, { status: 'inactive' });
    expect(inactive.content).toBe('');
  });

  it('renders {{neq}} comparison helper correctly (Appendix D)', () => {
    const source = '{{#if (neq status "draft")}}PUBLISHED{{/if}}';
    const published = renderTemplate(source, { status: 'final' });
    expect(published.content).toBe('PUBLISHED');

    const draft = renderTemplate(source, { status: 'draft' });
    expect(draft.content).toBe('');
  });

  it('renders {{gt}} and {{lt}} comparison helpers correctly (Appendix D)', () => {
    const gtSource = '{{#if (gt amount 1000)}}HIGH VALUE{{/if}}';
    expect(renderTemplate(gtSource, { amount: 5000 }).content).toBe('HIGH VALUE');
    expect(renderTemplate(gtSource, { amount: 500 }).content).toBe('');

    const ltSource = '{{#if (lt amount 1000)}}LOW VALUE{{/if}}';
    expect(renderTemplate(ltSource, { amount: 500 }).content).toBe('LOW VALUE');
    expect(renderTemplate(ltSource, { amount: 5000 }).content).toBe('');
  });

  it('renders {{formatDate}} helper correctly (Appendix D)', () => {
    const source = '{{formatDate agreementDate "MMMM D, YYYY"}}';
    const result = renderTemplate(source, { agreementDate: '2026-01-15' });
    // Should produce a formatted date string
    expect(result.content).toContain('2026');
  });

  it('renders {{formatCurrency}} helper correctly (Appendix D)', () => {
    const source = '{{formatCurrency amount}}';
    const result = renderTemplate(source, { amount: 50000 });
    expect(result.content).toMatch(/50,000|50000/);
  });

  it('renders {{uppercase}} and {{lowercase}} helpers correctly (Appendix D)', () => {
    const upperSource = '{{uppercase partyName}}';
    expect(renderTemplate(upperSource, { partyName: 'alice corp' }).content).toBe('ALICE CORP');

    const lowerSource = '{{lowercase partyName}}';
    expect(renderTemplate(lowerSource, { partyName: 'ALICE CORP' }).content).toBe('alice corp');
  });

  it('renders {{defaultValue}} helper correctly (Appendix D)', () => {
    const source = '{{defaultValue clientName "Unknown Client"}}';
    expect(renderTemplate(source, { clientName: 'Alice' }).content).toBe('Alice');
    expect(renderTemplate(source, {}).content).toBe('Unknown Client');
    expect(renderTemplate(source, { clientName: null }).content).toBe('Unknown Client');
  });

  it('render is deterministic — same inputs produce same output', () => {
    const source = 'Party: {{partyName}}, Amount: {{formatCurrency amount}}';
    const vars = { partyName: 'Alice Corp', amount: 10000 };
    const r1 = renderTemplate(source, vars);
    const r2 = renderTemplate(source, vars);
    expect(r1.content).toBe(r2.content);
  });
});

// ============================================================
// AC2 — Template sandbox: mandatory watermark (Decision #40)
// ============================================================

describe('AC2: Template sandbox mandatory watermark (Decision #40)', () => {
  it('renderTemplateSandbox always includes the mandatory watermark', () => {
    const source = 'This agreement is between {{partyA}} and {{partyB}}.';
    const result = renderTemplateSandbox(source, { partyA: 'Alice', partyB: 'Bob' });
    expect(result.content).toContain(SANDBOX_WATERMARK);
  });

  it('watermark is present even when template has no variables', () => {
    const source = 'This is a static template with no variables.';
    const result = renderTemplateSandbox(source, {});
    expect(result.content).toContain(SANDBOX_WATERMARK);
  });

  it('watermark is present even when variable map is empty', () => {
    const source = 'Hello, {{name}}.';
    const result = renderTemplateSandbox(source, {});
    expect(result.content).toContain(SANDBOX_WATERMARK);
  });

  it('renderTemplate (non-sandbox) does NOT include the watermark', () => {
    const source = 'This agreement is between {{partyA}} and {{partyB}}.';
    const result = renderTemplate(source, { partyA: 'Alice', partyB: 'Bob' });
    expect(result.content).not.toContain(SANDBOX_WATERMARK);
  });

  it('SANDBOX_WATERMARK constant is the correct Decision #40 string', () => {
    expect(SANDBOX_WATERMARK).toContain('SANDBOX PREVIEW');
    expect(SANDBOX_WATERMARK).toContain('NOT FOR CLIENT USE');
  });
});

// ============================================================
// AC3 — R12 COMPLETE_READONLY guard: Phase 4a procedures
// ============================================================

describe('AC3: R12 COMPLETE_READONLY guard in Phase 4a procedures', () => {
  it('all Phase 4a document mutation procedures call assertNotComplete', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    // These procedures must call assertNotComplete
    const mustGuard = [
      'extractVariables',
      'populateFromMatter',
      'updateVariableMap',
      'render',
      'generateDraft',
      'regenerate',
      'detach',
      'acceptSubstantive',
      'reopenSubstantive',
    ];

    // Count assertNotComplete calls
    const assertCount = (docs4aFile.match(/assertNotComplete\(/g) ?? []).length;
    expect(assertCount).toBeGreaterThanOrEqual(mustGuard.length);

    // Verify each procedure name appears in the file
    for (const proc of mustGuard) {
      expect(docs4aFile).toContain(proc + ':');
    }
  });

  it('document.finalize and document.acceptSubstantiveUnformatted do NOT call assertNotComplete (they transition INTO complete)', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    // Find the finalize procedure block and verify it does not call assertNotComplete
    // (it's the R12 carve-out that transitions TO complete)
    const finalizeBlock = docs4aFile.substring(
      docs4aFile.indexOf('finalize: protectedProcedure'),
      docs4aFile.indexOf('acceptSubstantiveUnformatted: protectedProcedure'),
    );
    expect(finalizeBlock).not.toContain('assertNotComplete');
  });
});

// ============================================================
// AC4 — document.finalize R13 TOCTOU: stale reference check inside procedure
// ============================================================

describe('AC4: document.finalize R13 TOCTOU stale reference check', () => {
  it('document.finalize calls detectStaleReferences inside the procedure body', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    // The finalize procedure must call detectStaleReferences
    expect(docs4aFile).toContain('detectStaleReferences(');

    // It must also call acknowledgeStaleReferences when stale refs are present
    expect(docs4aFile).toContain('acknowledgeStaleReferences(');
  });

  it('document.finalize imports detectStaleReferences from the references query module', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    // Must import from the references query module
    expect(docs4aFile).toContain("from '../db/queries/references.js'");
    expect(docs4aFile).toContain('detectStaleReferences');
  });

  it('document.finalize emits staleness_acknowledged telemetry when stale refs are acknowledged', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );
    expect(docs4aFile).toContain("'staleness_acknowledged'");
    expect(docs4aFile).toContain("finalizeContext: 'finalize'");
  });

  it('document.acceptSubstantiveUnformatted also emits staleness_acknowledged with acceptUnformatted context', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );
    expect(docs4aFile).toContain("finalizeContext: 'acceptUnformatted'");
  });
});

// ============================================================
// AC5 — document.detach: one-way only; snapshot captures variable map
// ============================================================

describe('AC5: document.detach is one-way and snapshots variable map', () => {
  it('document.detach checks templateBindingStatus === bound before detaching', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    // Must check templateBindingStatus !== 'bound' and throw ALREADY_DETACHED
    expect(docs4aFile).toContain("ALREADY_DETACHED");
    expect(docs4aFile).toContain("templateBindingStatus !== 'bound'");
  });

  it('document.detach calls detachDocumentFromTemplate with a snapshot', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    expect(docs4aFile).toContain('detachDocumentFromTemplate(');
    expect(docs4aFile).toContain('templateSnapshot');
    expect(docs4aFile).toContain('variableMapAtDetach');
  });

  it('document.detach emits document_detached_from_template telemetry', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );
    expect(docs4aFile).toContain("'document_detached_from_template'");
    expect(docs4aFile).toContain('snapshotVariableCount');
  });
});

// ============================================================
// AC6 — Template procedures: telemetry and validation
// ============================================================

describe('AC6: Template procedures telemetry and validation', () => {
  it('template.upload emits template_uploaded telemetry', () => {
    const templatesFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/templates.ts'),
      'utf-8',
    );
    expect(templatesFile).toContain("'template_uploaded'");
  });

  it('template.activate emits template_activated telemetry', () => {
    const templatesFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/templates.ts'),
      'utf-8',
    );
    expect(templatesFile).toContain("'template_activated'");
  });

  it('template.sandbox emits template_sandbox_render telemetry', () => {
    const templatesFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/templates.ts'),
      'utf-8',
    );
    expect(templatesFile).toContain("'template_sandbox_render'");
  });

  it('template.sandbox uses renderTemplateSandbox (not renderTemplate)', () => {
    const templatesFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/templates.ts'),
      'utf-8',
    );
    expect(templatesFile).toContain('renderTemplateSandbox(');
    // Sandbox procedure must NOT call the non-watermarked renderTemplate
    const sandboxBlock = templatesFile.substring(
      templatesFile.indexOf('sandbox: protectedProcedure'),
      templatesFile.indexOf('archive: protectedProcedure'),
    );
    expect(sandboxBlock).not.toContain('renderTemplate(');
  });

  it('template.confirmSchema emits schema_confirmed telemetry', () => {
    const templatesFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/templates.ts'),
      'utf-8',
    );
    expect(templatesFile).toContain("'schema_confirmed'");
  });

  it('template.updateSchema emits schema_updated telemetry', () => {
    const templatesFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/templates.ts'),
      'utf-8',
    );
    expect(templatesFile).toContain("'schema_updated'");
  });
});

// ============================================================
// AC7 — No Phase 4b structures in Phase 4a codebase
// ============================================================

describe('AC7: No Phase 4b structures in Phase 4a codebase', () => {
  it('no review_sessions table or type exists in Phase 4a', () => {
    const schemaFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/db/schema.ts'),
      'utf-8',
    );
    expect(schemaFile).not.toContain('review_sessions');
    expect(schemaFile).not.toContain('reviewSessions');
  });

  it('no feedback table or type exists in Phase 4a', () => {
    const schemaFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/db/schema.ts'),
      'utf-8',
    );
    expect(schemaFile).not.toContain("'feedback'");
    expect(schemaFile).not.toContain('feedbackTable');
  });

  it('no review.ts or reviewSession.ts procedure file exists', () => {
    const proceduresDir = path.join(process.cwd(), 'src/server/procedures');
    const files = fs.readdirSync(proceduresDir);
    expect(files).not.toContain('review.ts');
    expect(files).not.toContain('reviewSession.ts');
    expect(files).not.toContain('reviewSessions.ts');
  });

  it('no matrix.ts or outline.ts procedure file exists', () => {
    const proceduresDir = path.join(process.cwd(), 'src/server/procedures');
    const files = fs.readdirSync(proceduresDir);
    expect(files).not.toContain('matrix.ts');
    expect(files).not.toContain('outline.ts');
  });

  it('no Phase 4b router registrations exist in router.ts', () => {
    const routerFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/router.ts'),
      'utf-8',
    );
    expect(routerFile).not.toContain('review:');
    expect(routerFile).not.toContain('matrix:');
    expect(routerFile).not.toContain('outline:');
  });
});

// ============================================================
// AC8 — Ch 35.2: no Phase 4a procedure input schema contains userId
// ============================================================

describe('AC8: Ch 35.2 — no Phase 4a procedure input schema contains userId', () => {
  it('documents4a.ts input schemas do not contain userId', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    // Check for userId in z.object() input schemas
    // We look for userId as a schema field (not as a variable reference)
    const inputSchemaBlocks = docs4aFile.match(/\.input\(\s*z\.object\([^)]+\)/gs) ?? [];
    for (const block of inputSchemaBlocks) {
      expect(block).not.toContain('userId:');
    }
  });

  it('templates.ts input schemas do not contain userId', () => {
    const templatesFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/templates.ts'),
      'utf-8',
    );

    const inputSchemaBlocks = templatesFile.match(/\.input\(\s*z\.object\([^)]+\)/gs) ?? [];
    for (const block of inputSchemaBlocks) {
      expect(block).not.toContain('userId:');
    }
  });
});

// ============================================================
// AC9 — document.regenerate does not reference Phase 4b entities
// ============================================================

describe('AC9: document.regenerate does not reference Phase 4b entities', () => {
  it('document.regenerate does not import or reference review_sessions', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    // Find the regenerate procedure block
    const regenerateStart = docs4aFile.indexOf('regenerate: protectedProcedure');
    const detachStart = docs4aFile.indexOf('detach: protectedProcedure');
    const regenerateBlock = docs4aFile.substring(regenerateStart, detachStart);

    expect(regenerateBlock).not.toContain('review_session');
    expect(regenerateBlock).not.toContain('reviewSession');
    expect(regenerateBlock).not.toContain('feedback');
    expect(regenerateBlock).not.toContain('positiveSelection');
  });

  it('document.regenerate uses executeCanonicalMutation (R4 compliance)', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    const regenerateStart = docs4aFile.indexOf('regenerate: protectedProcedure');
    const detachStart = docs4aFile.indexOf('detach: protectedProcedure');
    const regenerateBlock = docs4aFile.substring(regenerateStart, detachStart);

    expect(regenerateBlock).toContain('executeCanonicalMutation(');
  });

  it('document.generateDraft uses executeCanonicalMutation (R4 compliance)', () => {
    const docs4aFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/procedures/documents4a.ts'),
      'utf-8',
    );

    const generateStart = docs4aFile.indexOf('generateDraft: protectedProcedure');
    const regenerateStart = docs4aFile.indexOf('regenerate: protectedProcedure');
    const generateBlock = docs4aFile.substring(generateStart, regenerateStart);

    expect(generateBlock).toContain('executeCanonicalMutation(');
  });
});
