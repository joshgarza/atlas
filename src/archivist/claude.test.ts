import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClaudeCodeConfig, queryClaudeCode } from './claude.js';
import type { ClaudeCodeConfig } from './claude.js';

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Wrap mockExecFile to work with promisify: execFile(cmd, args, opts, callback)
beforeEach(() => {
  mockExecFile.mockReset();
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
      callback(null, { stdout: '{}', stderr: '' });
    },
  );
});

describe('createClaudeCodeConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ARCHIVIST_MODEL;
    delete process.env.ARCHIVIST_TIMEOUT_MS;
    delete process.env.ATLAS_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns sensible defaults', () => {
    const config = createClaudeCodeConfig();

    expect(config.model).toBe('sonnet');
    expect(config.allowedTools).toEqual([]);
    expect(config.timeoutMs).toBe(120_000);
    expect(config.atlasBaseUrl).toBe('http://localhost:3001');
    expect(config.systemPrompt).toContain('Archivist');
  });

  it('respects environment variables', () => {
    process.env.ARCHIVIST_MODEL = 'opus';
    process.env.ARCHIVIST_TIMEOUT_MS = '60000';
    process.env.ATLAS_BASE_URL = 'http://custom:9000';

    const config = createClaudeCodeConfig();

    expect(config.model).toBe('opus');
    expect(config.timeoutMs).toBe(60_000);
    expect(config.atlasBaseUrl).toBe('http://custom:9000');
    expect(config.systemPrompt).toContain('http://custom:9000');
  });

  it('applies overrides over env and defaults', () => {
    process.env.ARCHIVIST_MODEL = 'opus';

    const config = createClaudeCodeConfig({
      model: 'haiku',
      allowedTools: ['WebFetch'],
    });

    expect(config.model).toBe('haiku');
    expect(config.allowedTools).toEqual(['WebFetch']);
  });

  it('uses atlasBaseUrl override in system prompt', () => {
    const config = createClaudeCodeConfig({
      atlasBaseUrl: 'http://test:5000',
    });

    expect(config.atlasBaseUrl).toBe('http://test:5000');
    expect(config.systemPrompt).toContain('http://test:5000');
  });
});

describe('queryClaudeCode', () => {
  function makeConfig(overrides?: Partial<ClaudeCodeConfig>): ClaudeCodeConfig {
    return createClaudeCodeConfig(overrides);
  }

  function mockSuccess(response: Record<string, unknown>) {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
        callback(null, { stdout: JSON.stringify(response), stderr: '' });
      },
    );
  }

  function mockFailure(error: Error & { killed?: boolean }) {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
        callback(error);
      },
    );
  }

  function getArgs(): string[] {
    return mockExecFile.mock.calls[0][1] as string[];
  }

  it('passes correct CLI args for pure reasoning mode (no tools)', async () => {
    mockSuccess({ result: 'ok' });

    await queryClaudeCode('test prompt', makeConfig());

    const args = getArgs();
    expect(args).toContain('-p');
    expect(args).toContain('test prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--system-prompt');
    // Pure reasoning: --tools "" to disable all tools
    expect(args).toContain('--tools');
    expect(args).toContain('');
    // Should NOT have --allowedTools
    expect(args).not.toContain('--allowedTools');
    // Should NOT have --max-turns (not a valid CLI flag)
    expect(args).not.toContain('--max-turns');
  });

  it('passes --allowedTools when tools are specified', async () => {
    mockSuccess({ result: 'ok' });

    await queryClaudeCode('test', makeConfig({ allowedTools: ['WebFetch'] }));

    const args = getArgs();
    expect(args).toContain('--allowedTools');
    expect(args).toContain('WebFetch');
    // Should NOT have --tools ""
    const toolsIdx = args.indexOf('--tools');
    expect(toolsIdx).toBe(-1);
  });

  it('parses a successful JSON response', async () => {
    mockSuccess({
      result: 'analysis complete',
      cost_usd: 0.05,
      duration_ms: 3000,
      session_id: 'sess-123',
    });

    const result = await queryClaudeCode('analyze this', makeConfig());

    expect(result.result).toBe('analysis complete');
    expect(result.costUsd).toBe(0.05);
    expect(result.durationMs).toBe(3000);
    expect(result.sessionId).toBe('sess-123');
  });

  it('throws on Claude Code error response', async () => {
    mockSuccess({ is_error: true, result: 'something went wrong' });

    await expect(queryClaudeCode('test', makeConfig())).rejects.toThrow(
      'Claude Code error: something went wrong',
    );
  });

  it('throws descriptive error on invalid JSON output', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
        callback(null, { stdout: 'not json at all', stderr: '' });
      },
    );

    await expect(queryClaudeCode('test', makeConfig())).rejects.toThrow(
      /Claude Code returned invalid JSON.*not json at all/,
    );
  });

  it('throws timeout error when process is killed', async () => {
    const err = new Error('killed') as Error & { killed: boolean };
    err.killed = true;
    mockFailure(err);

    await expect(queryClaudeCode('test', makeConfig())).rejects.toThrow(
      /timed out after 120000ms/,
    );
  });

  it('throws on general execution failure', async () => {
    mockFailure(new Error('command not found'));

    await expect(queryClaudeCode('test', makeConfig())).rejects.toThrow(
      'Claude Code invocation failed: command not found',
    );
  });

  it('defaults missing response fields gracefully', async () => {
    mockSuccess({});

    const result = await queryClaudeCode('test', makeConfig());

    expect(result.result).toBe('');
    expect(result.costUsd).toBe(0);
    expect(result.durationMs).toBe(0);
    expect(result.sessionId).toBe('');
  });
});
