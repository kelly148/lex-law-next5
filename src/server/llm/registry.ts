/**
 * LLM Provider Registry (Ch 22.1, Ch 22.2)
 *
 * Resolves "provider:model" strings to LlmClient instances.
 * This is the single point of dispatch for all LLM calls.
 *
 * API keys are read at invocation time (inside each adapter's generate()),
 * not at registry construction time. Missing keys for uninvoked providers
 * are not startup errors (Ch 22.3).
 */

import { createAnthropicAdapter } from './anthropic.js';
import { createOpenAiAdapter } from './openai.js';
import { createGoogleAdapter } from './google.js';
import { createXaiAdapter } from './xai.js';
import { parseModelString } from './config.js';
import type { LlmClient } from './types.js';

// Allow test injection of a mock adapter
let _testAdapter: LlmClient | null = null;

/**
 * Inject a mock adapter for testing. Call with null to restore real adapters.
 * Only effective when NODE_ENV !== 'production'.
 */
export function setTestLlmAdapter(adapter: LlmClient | null): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('setTestLlmAdapter cannot be called in production');
  }
  _testAdapter = adapter;
}

/**
 * Resolve a "provider:model" string to an LlmClient instance.
 * Throws if the provider is unknown.
 */
export function resolveAdapter(modelString: string): LlmClient {
  // Test injection takes precedence
  if (_testAdapter !== null) return _testAdapter;

  const { providerId, modelId } = parseModelString(modelString);

  switch (providerId) {
    case 'anthropic':
      return createAnthropicAdapter(modelId);
    case 'openai':
      return createOpenAiAdapter(modelId);
    case 'google':
      return createGoogleAdapter(modelId);
    case 'xai':
      return createXaiAdapter(modelId);
    default:
      throw new Error(
        `Unknown provider "${providerId}" in model string "${modelString}". ` +
          `Supported providers: anthropic, openai, google, xai.`,
      );
  }
}
