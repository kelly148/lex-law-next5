import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const informationRequestSource = readFileSync(
  resolve(repoRoot, 'src/server/procedures/informationRequest.ts'),
  'utf8',
);
const informationRequestPageSource = readFileSync(
  resolve(repoRoot, 'src/client/pages/InformationRequestPage.tsx'),
  'utf8',
);

describe('MR-UAT-MATERIALS-2 completed-questionnaire material bridge', () => {
  it('adds an explicit protected mutation that only converts completed answered questionnaires', () => {
    expect(informationRequestSource).toContain('createMaterialFromCompleted: protectedProcedure');
    expect(informationRequestSource).toContain("matrix.status !== 'complete'");
    expect(informationRequestSource).toContain('QUESTIONNAIRE_NOT_COMPLETE');
    expect(informationRequestSource).toContain('answeredCount === 0');
    expect(informationRequestSource).toContain('QUESTIONNAIRE_HAS_NO_ANSWERS');
    expect(informationRequestSource).toContain('getMatterById(matrix.matterId, userId)');
    expect(informationRequestSource).toContain('listItemsForInformationRequest(input.matrixId, userId)');
  });

  it('creates an extracted text/plain matter material with source tags used by the drafting context pipeline', () => {
    expect(informationRequestSource).toContain("const COMPLETED_QUESTIONNAIRE_TAG = 'completed_questionnaire'");
    expect(informationRequestSource).toContain('informationRequestSourceTag(input.matrixId)');
    expect(informationRequestSource).toContain("filename: `Completed Questionnaire - ${input.matrixId}.txt`");
    expect(informationRequestSource).toContain("mimeType: 'text/plain'");
    expect(informationRequestSource).toContain("extractionStatus: 'extracted'");
    expect(informationRequestSource).toContain('textContent: buildCompletedQuestionnaireMaterialText');
    expect(informationRequestSource).toContain("uploadSource: 'paste'");
    expect(informationRequestSource).toContain("tags: [COMPLETED_QUESTIONNAIRE_TAG, sourceTag]");
  });

  it('is idempotent for one converted material per questionnaire matrix', () => {
    expect(informationRequestSource).toContain('listMaterialsForMatter(matrix.matterId, userId)');
    expect(informationRequestSource).toContain('material.tags.includes(COMPLETED_QUESTIONNAIRE_TAG)');
    expect(informationRequestSource).toContain('material.tags.includes(sourceTag)');
    expect(informationRequestSource).toContain('return { created: false, material: existing }');
    expect(informationRequestSource).toContain('return { created: true, material }');
  });

  it('exposes a narrow eligible client action for completed questionnaires and invalidates material-facing views', () => {
    expect(informationRequestPageSource).toContain('createMaterialMutation');
    expect(informationRequestPageSource).toContain('utils.client.informationRequest.createMaterialFromCompleted.mutate(input)');
    expect(informationRequestPageSource).toContain("matrix.status === 'complete'");
    expect(informationRequestPageSource).toContain('Add to Client Materials');
    expect(informationRequestPageSource).toContain('Completed questionnaire saved to Client Materials.');
    expect(informationRequestPageSource).toContain('utils.materials.list.invalidate');
    expect(informationRequestPageSource).toContain('utils.informationRequest.list.invalidate');
  });
});
