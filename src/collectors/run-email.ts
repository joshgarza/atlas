#!/usr/bin/env node

/**
 * Email Collector CLI for Atlas
 *
 * Usage:
 *   npx tsx src/collectors/run-email.ts          # one-time import
 *   npx tsx src/collectors/run-email.ts --poll    # import + poll for new emails
 *
 * Environment variables:
 *   GMAIL_CLIENT_ID       - Google OAuth2 client ID (required)
 *   GMAIL_CLIENT_SECRET   - Google OAuth2 client secret (required)
 *   GMAIL_REFRESH_TOKEN   - Google OAuth2 refresh token (required)
 *   ANTHROPIC_API_KEY     - Anthropic API key for LLM summarization (required)
 *   ATLAS_URL             - Atlas API base URL (default: http://localhost:3001)
 *   EMAIL_LABELS          - Comma-separated Gmail labels to filter (optional)
 *   EMAIL_SENDERS         - Comma-separated sender addresses to filter (optional)
 *   EMAIL_IMPORTANCE      - Set to "true" to only import important emails (optional)
 *   EMAIL_AFTER           - Only import emails after this date, ISO format (optional)
 *   EMAIL_POLL_INTERVAL   - Poll interval in seconds (default: 300)
 *   EMAIL_STATE_DIR       - Directory to store collector state (default: ./data)
 */

import type { EmailConfig } from './email.js';
import { importEmails, pollEmails } from './email.js';

const DEFAULT_ATLAS_URL = 'http://localhost:3001';
const DEFAULT_POLL_INTERVAL = 300;
const DEFAULT_STATE_DIR = './data';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} environment variable is required`);
    process.exit(1);
  }
  return value;
}

function main(): void {
  const clientId = requireEnv('GMAIL_CLIENT_ID');
  const clientSecret = requireEnv('GMAIL_CLIENT_SECRET');
  const refreshToken = requireEnv('GMAIL_REFRESH_TOKEN');
  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const atlasUrl = process.env['ATLAS_URL'] ?? DEFAULT_ATLAS_URL;
  const pollMode = process.argv.includes('--poll');

  const labels = process.env['EMAIL_LABELS']
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const senders = process.env['EMAIL_SENDERS']
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const importance = process.env['EMAIL_IMPORTANCE'] === 'true';
  const after = process.env['EMAIL_AFTER'];
  const pollInterval =
    parseInt(process.env['EMAIL_POLL_INTERVAL'] ?? String(DEFAULT_POLL_INTERVAL), 10) * 1000;
  const stateDir = process.env['EMAIL_STATE_DIR'] ?? DEFAULT_STATE_DIR;

  const config: EmailConfig = {
    clientId,
    clientSecret,
    refreshToken,
    anthropicApiKey,
    atlasUrl,
    labels,
    senders,
    importance,
    after,
    stateDir,
  };

  console.log('=== Email Collector for Atlas ===');
  console.log(`  Atlas:       ${atlasUrl}`);
  console.log(`  Mode:        ${pollMode ? 'import + poll' : 'one-time import'}`);
  if (labels?.length) console.log(`  Labels:      ${labels.join(', ')}`);
  if (senders?.length) console.log(`  Senders:     ${senders.join(', ')}`);
  if (importance) console.log(`  Importance:  only important emails`);
  if (after) console.log(`  After:       ${after}`);
  console.log('');

  importEmails(config)
    .then((summary) => {
      console.log('');
      console.log('=== Import Summary ===');
      console.log(`  Threads scanned:  ${summary.threadsScanned}`);
      console.log(`  Events created:   ${summary.eventsCreated}`);
      console.log(`  Errors:           ${summary.errors.length}`);
      console.log(`  Duration:         ${(summary.durationMs / 1000).toFixed(1)}s`);

      if (summary.errors.length > 0) {
        console.log('');
        console.log('  Failed threads:');
        for (const { threadId, error } of summary.errors) {
          console.log(`    - ${threadId}: ${error}`);
        }
      }

      if (pollMode) {
        console.log('');
        console.log(`Starting poll mode (every ${pollInterval / 1000}s, Ctrl+C to stop)...`);
        const poller = pollEmails(config, pollInterval);

        const shutdown = (): void => {
          console.log('\nStopping poller...');
          poller.stop();
          process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Fatal error: ${message}`);
      process.exit(1);
    });
}

main();
