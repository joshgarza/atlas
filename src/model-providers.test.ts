import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAiProviderConfig,
  getEmbeddingProvider,
  getReasoningProvider,
} from './model-providers.js';

describe('model providers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ATLAS_EMBEDDING_PROVIDER;
    delete process.env.ATLAS_REASONING_PROVIDER;
    delete process.env.VOYAGE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to the current production providers', () => {
    expect(getAiProviderConfig()).toEqual({
      embeddingProvider: 'voyage-api',
      reasoningProvider: 'anthropic-api',
    });
  });

  it('respects explicit provider selection', () => {
    process.env.ATLAS_EMBEDDING_PROVIDER = 'disabled';
    process.env.ATLAS_REASONING_PROVIDER = 'claude-code';

    expect(getAiProviderConfig()).toEqual({
      embeddingProvider: 'disabled',
      reasoningProvider: 'claude-code',
    });
    expect(getEmbeddingProvider().name).toBe('disabled');
    expect(getReasoningProvider().name).toBe('claude-code');
  });

  it('rejects unsupported provider names', () => {
    process.env.ATLAS_EMBEDDING_PROVIDER = 'bogus';

    expect(() => getAiProviderConfig()).toThrow(
      'Unsupported embedding provider "bogus"',
    );
  });

  it('marks the voyage embedding provider available when a supported key is set', () => {
    process.env.VOYAGE_API_KEY = 'voyage-test-key';

    expect(getEmbeddingProvider().isAvailable()).toBe(true);
  });

  it('marks the anthropic reasoning provider unavailable without a key', () => {
    expect(getReasoningProvider().isAvailable()).toBe(false);
  });

  it('marks the disabled providers unavailable', () => {
    process.env.ATLAS_EMBEDDING_PROVIDER = 'disabled';
    process.env.ATLAS_REASONING_PROVIDER = 'disabled';

    expect(getEmbeddingProvider().isAvailable()).toBe(false);
    expect(getReasoningProvider().isAvailable()).toBe(false);
  });
});
