/**
 * DOC-CLIENT-TARGET-1 Increment 4 — enumeration + naming + status (source-audit; no test DB).
 *
 * Confirms the export filename carries the target identity, per-instance status rides the existing
 * state engine (instancesForType returns workflowState), and the assessment enumerates per-client
 * instances via RecommendedInstances.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('DOC-CLIENT-TARGET-1 Inc 4: export naming carries target identity', () => {
  const index = read('src/server/index.ts');

  it('the export filename folds in the bound target (subject / joint set), not a bare title', () => {
    expect(index).toContain('resolveDraftingSubjectScope(doc, userId)');
    expect(index).toContain('titleWithTarget');
    // "<title> - <target name>"
    expect(index).toMatch(/\$\{doc\.title\} - \$\{targetScope\.subjectName\}/);
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 4: per-instance status reuses the state engine', () => {
  it('instancesForType returns the existing document workflowState (no parallel status vocabulary)', () => {
    const instances = read('src/server/documents/instances.ts');
    expect(instances).toContain('workflowState: string | null');
    expect(instances).toContain('workflowState: d.workflowState');
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 4: assessment enumerates per-client instances', () => {
  it('MatterIntakePanel renders RecommendedInstances (instances, not bare types)', () => {
    const panel = read('src/client/components/MatterIntakePanel.tsx');
    expect(panel).toContain('RecommendedInstances');
    expect(panel).toContain('recommendedDocuments={a.recommendedDocuments');
  });

  it('RecommendedInstances reads the taxonomy through the shared accessor (single source)', () => {
    const recs = read('src/client/components/RecommendedInstances.tsx');
    expect(recs).toContain('getDocTypeConfig');
    expect(recs).not.toContain('DOC_TYPE_CONFIGS');
    // individual -> per-client expansion; party_set -> one joint row
    expect(recs).toContain("config?.targetStructure === 'individual_subject'");
    expect(recs).toContain("config?.targetStructure === 'party_set'");
  });
});
