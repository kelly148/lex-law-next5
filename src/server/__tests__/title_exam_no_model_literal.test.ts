/**
 * TITLE-EXAM-1 (§4b, operator-directed) — provider-agnostic role bindings guard.
 *
 * Every exam lane / reconciler / Express-reviewer role must resolve its model ID from the central
 * pinned-model config (src/server/llm/config.ts) at runtime — NEVER a model-ID literal in module code or
 * a prompt. This source-audit scans the ENTIRE src/server/titleExam/ module and asserts no file contains a
 * provider-prefixed or model-family literal, so any of the four providers (or a future one) can fill any
 * role by configuration alone. config.ts (the sanctioned home for literals) is NOT under this directory
 * and is therefore correctly out of scope.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const MODULE_DIR = path.resolve(__dirname, '../titleExam');

// Provider-prefix form (anthropic:/openai:/google:/xai:) OR bare model-family form (claude-/gpt-/gemini-/grok-).
const MODEL_LITERAL = /(anthropic|openai|google|xai):|\bclaude-|\bgpt-|\bgemini-|\bgrok-/i;

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('TITLE-EXAM-1 §4b — no model-ID literal in the title-exam module', () => {
  const files = listTsFiles(MODULE_DIR);

  it('the module directory exists and has source files (guards a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no title-exam module file hardcodes a provider/model-family literal (resolve via config.ts)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      if (MODEL_LITERAL.test(src)) offenders.push(path.basename(f));
    }
    expect(offenders, `title-exam module files with a hardcoded model literal: ${offenders.join(', ')}`).toEqual([]);
  });
});
