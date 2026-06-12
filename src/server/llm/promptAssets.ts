/**
 * promptAssets.ts — INSTR-1A0 (INSTRUCTIONS-LEG-1): prompt-asset manifest + loader.
 *
 * The operator's proven master prompts are committed VERBATIM under prompts/assets/ and
 * pinned by SHA-256 in prompts/manifest.json (logical ID -> file -> sha256). This module
 * loads and validates them at boot: any byte drift between the committed asset and its
 * recorded hash is a HARD startup failure (fail loudly, never serve a silently-mutated
 * master). prompts/** is pinned `text eol=lf` in .gitattributes so the working-tree bytes
 * (and therefore the hash) are identical on every platform regardless of core.autocrlf.
 *
 * The only asset WIRED this increment is `master/claude/te` (the full text of
 * TE_Master_Instructions_v1.md). The cross-platform masters file is committed for version
 * control only and is intentionally NOT in the manifest — its assets are carved out in
 * later increments.
 *
 * KNOWN + INTENTIONAL (INSTR-1A0): the T&E asset contains a Claude-container DOCX pipeline
 * section (its section 8) with paths that do not exist via the API. It ships verbatim
 * anyway — byte-fidelity is the experiment. If draft outputs emit container paths, that is
 * a measured baseline defect to LOG, not fix here.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Logical ID of the one asset wired in INSTR-1A0. */
export const MASTER_CLAUDE_TE = 'master/claude/te';

/** Logical ID of the general Law Firm master (INSTR-2A registered; INSTR-2B-core selects it). */
export const MASTER_CLAUDE_LAWFIRM = 'master/claude/lawfirm';

/** Manifest location, relative to the app base dir (repo root locally; /app in the image). */
export const PROMPT_MANIFEST_PATH = 'prompts/manifest.json';

export interface PromptAsset {
  /** Logical ID (manifest key), e.g. "master/claude/te". */
  id: string;
  /** File path as recorded in the manifest (base-dir relative). */
  file: string;
  /** SHA-256 (lowercase hex) of the asset file's exact bytes, as pinned in the manifest. */
  sha256: string;
  /** The asset text (UTF-8 decode of the verified bytes). */
  text: string;
}

interface ManifestEntry {
  file: string;
  sha256: string;
}

interface PromptManifest {
  version: number;
  assets: Record<string, ManifestEntry>;
}

/** SHA-256 lowercase-hex helper (shared with the snapshot writer so hashes are comparable). */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

let _cache: Map<string, PromptAsset> | null = null;

function parseManifest(raw: string, manifestFile: string): PromptManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Prompt manifest ${manifestFile} is not valid JSON: ${String(err)}`);
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as PromptManifest).version !== 'number' ||
    typeof (parsed as PromptManifest).assets !== 'object' ||
    (parsed as PromptManifest).assets === null
  ) {
    throw new Error(`Prompt manifest ${manifestFile} has an invalid shape (need { version, assets }).`);
  }
  const manifest = parsed as PromptManifest;
  for (const [id, entry] of Object.entries(manifest.assets)) {
    if (!entry || typeof entry.file !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) {
      throw new Error(
        `Prompt manifest ${manifestFile} entry "${id}" is invalid (need { file, sha256: 64 lowercase hex }).`,
      );
    }
  }
  return manifest;
}

/**
 * Load every manifest asset, verify each file's SHA-256 against the manifest, and cache.
 * Called once at server startup (next to validateLlmConfig) — a hash mismatch or missing
 * file THROWS and the server does not accept connections.
 */
export function loadPromptAssets(baseDir: string = process.cwd()): Map<string, PromptAsset> {
  const manifestFile = resolve(baseDir, PROMPT_MANIFEST_PATH);
  const manifest = parseManifest(readFileSync(manifestFile, 'utf8'), manifestFile);

  const loaded = new Map<string, PromptAsset>();
  for (const [id, entry] of Object.entries(manifest.assets)) {
    const assetFile = resolve(baseDir, entry.file);
    const bytes = readFileSync(assetFile);
    const actual = sha256Hex(bytes);
    if (actual !== entry.sha256) {
      throw new Error(
        `Prompt asset hash mismatch for "${id}" (${entry.file}): ` +
          `manifest pins ${entry.sha256} but the file on disk hashes to ${actual}. ` +
          `The committed asset bytes have drifted — refusing to start.`,
      );
    }
    loaded.set(id, { id, file: entry.file, sha256: entry.sha256, text: bytes.toString('utf8') });
  }

  _cache = loaded;
  return loaded;
}

/**
 * Return a verified prompt asset by logical ID. Loads (and validates) the manifest on
 * first use if the boot-time load has not run. Throws on an unknown ID — an asset that
 * is not in the manifest must never be silently substituted.
 */
export function getPromptAsset(id: string): PromptAsset {
  const cache = _cache ?? loadPromptAssets();
  const asset = cache.get(id);
  if (!asset) {
    throw new Error(`Unknown prompt asset "${id}" — not present in ${PROMPT_MANIFEST_PATH}.`);
  }
  return asset;
}

/** Test seam: clear the cache so a test can exercise the load path. */
export function clearPromptAssetCacheForTests(): void {
  _cache = null;
}
