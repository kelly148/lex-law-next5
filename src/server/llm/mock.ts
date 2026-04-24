/**
 * Mock LLM Provider Adapter (Phase 2 test infrastructure)
 *
 * Deterministic mock for use in unit and integration tests.
 * Does not make network calls. Behavior is configured at construction time.
 *
 * Usage in tests:
 *   const mock = new MockLlmAdapter({ content: 'test output' });
 *   // or with structured output:
 *   const mock = new MockLlmAdapter({ structuredContent: { title: 'Test', suggestions: [] } });
 *   // or to simulate failure:
 *   const mock = new MockLlmAdapter({ errorClass: 'api_error', errorMessage: 'Simulated failure' });
 *   // or to simulate timeout:
 *   const mock = new MockLlmAdapter({ simulateTimeout: true });
 */

import { LlmProviderError, type LlmClient, type LlmGenerateParams, type LlmGenerateResult } from './types.js';

export interface MockLlmAdapterOptions {
  /** Free-form text response (for drafter-family roles) */
  content?: string;
  /** Structured output response (for reviewer/evaluator/etc roles) */
  structuredContent?: Record<string, unknown>;
  /** Simulate a provider error */
  errorClass?: 'api_error' | 'parse_error' | 'other';
  errorMessage?: string;
  /** Simulate a timeout by rejecting with AbortError */
  simulateTimeout?: boolean;
  /** Simulated token counts */
  tokensPrompt?: number;
  tokensCompletion?: number;
  /** Optional delay in ms before responding (for testing async behavior) */
  delayMs?: number;
}

export class MockLlmAdapter implements LlmClient {
  private readonly options: MockLlmAdapterOptions;

  constructor(options: MockLlmAdapterOptions = {}) {
    this.options = {
      content: 'Mock LLM response content',
      tokensPrompt: 100,
      tokensCompletion: 50,
      ...options,
    };
  }

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    const { signal } = params;

    // Respect the AbortSignal — if already aborted, throw immediately
    if (signal.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }

    // Optional delay (for testing async behavior / timeout simulation)
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }

    // Simulate timeout: wait until the signal fires (or a very short real timeout)
    // This ensures timeoutSignal.aborted is true in the caller so it's classified as a timeout
    if (this.options.simulateTimeout) {
      await new Promise<void>((_resolve, reject) => {
        // Listen for the provided signal (which includes the real timeout signal)
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = signal.reason instanceof Error ? signal.reason.name : 'AbortError';
          reject(err);
        });
        // If signal is already aborted, reject immediately
        if (signal.aborted) {
          const err = new Error('The operation was aborted');
          err.name = signal.reason instanceof Error ? signal.reason.name : 'AbortError';
          reject(err);
        }
        // Otherwise wait — the LLM_FETCH_TIMEOUT_MS signal will fire eventually
        // In tests, we override LLM_FETCH_TIMEOUT_MS to a small value via the config
      });
    }

    // Simulate provider error
    if (this.options.errorClass) {
      throw new LlmProviderError(
        this.options.errorClass,
        this.options.errorMessage ?? `Simulated ${this.options.errorClass}`,
      );
    }

    // Return structured content if provided
    if (this.options.structuredContent !== undefined) {
      return {
        content: this.options.structuredContent,
        tokensPrompt: this.options.tokensPrompt ?? 100,
        tokensCompletion: this.options.tokensCompletion ?? 50,
        providerMetadata: { provider: 'mock', model: 'mock-model' },
      };
    }

    // Return free-form text
    return {
      content: this.options.content ?? 'Mock LLM response content',
      tokensPrompt: this.options.tokensPrompt ?? 100,
      tokensCompletion: this.options.tokensCompletion ?? 50,
      providerMetadata: { provider: 'mock', model: 'mock-model' },
    };
  }
}

export function createMockAdapter(options?: MockLlmAdapterOptions): LlmClient {
  return new MockLlmAdapter(options);
}
