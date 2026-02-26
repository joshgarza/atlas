#!/usr/bin/env node

/**
 * Google Calendar Collector CLI for Atlas
 *
 * Usage:
 *   npx tsx src/collectors/run-google-calendar.ts              # one-time sync
 *   npx tsx src/collectors/run-google-calendar.ts --poll        # sync + periodic polling
 *
 * Environment variables:
 *   GOOGLE_ACCESS_TOKEN    - OAuth2 access token (preferred auth method)
 *   GOOGLE_REFRESH_TOKEN   - OAuth2 refresh token (enables automatic token renewal)
 *   GOOGLE_CLIENT_ID       - OAuth2 client ID (required for token refresh)
 *   GOOGLE_CLIENT_SECRET   - OAuth2 client secret (required for token refresh)
 *   GOOGLE_API_KEY         - API key (alternative auth, read-only public calendars)
 *   GOOGLE_CALENDAR_IDS    - comma-separated calendar IDs (default: "primary")
 *   ATLAS_URL              - Atlas API base URL (default: http://localhost:3001)
 *   SYNC_LOOKBACK_DAYS     - number of days to look back on initial sync (default: 30)
 *   POLL_INTERVAL_MS       - polling interval in ms (default: 300000 = 5 minutes)
 */

import { syncCalendars, startPolling, type TokenHolder } from './google-calendar.js';

const DEFAULT_ATLAS_URL = 'http://localhost:3001';
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

function main(): void {
  const accessToken = process.env['GOOGLE_ACCESS_TOKEN'];
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const apiKey = process.env['GOOGLE_API_KEY'];
  const atlasUrl = process.env['ATLAS_URL'] ?? DEFAULT_ATLAS_URL;
  const calendarIds = (process.env['GOOGLE_CALENDAR_IDS'] ?? 'primary')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const lookbackDays = Number(process.env['SYNC_LOOKBACK_DAYS']) || DEFAULT_LOOKBACK_DAYS;
  const pollIntervalMs = Number(process.env['POLL_INTERVAL_MS']) || DEFAULT_POLL_INTERVAL_MS;
  const pollMode = process.argv.includes('--poll');

  if (!accessToken && !apiKey) {
    console.error('Error: Set GOOGLE_ACCESS_TOKEN or GOOGLE_API_KEY');
    process.exit(1);
  }

  if (pollMode && accessToken && !refreshToken) {
    console.warn('Warning: --poll mode without GOOGLE_REFRESH_TOKEN — token will expire after ~1 hour');
  }

  // Shared mutable token holder — refreshed tokens persist across all calls
  const tokenHolder: TokenHolder = {
    accessToken,
    refreshToken,
    clientId,
    clientSecret,
  };

  console.log('=== Google Calendar Collector for Atlas ===');
  console.log(`  Calendars: ${calendarIds.join(', ')}`);
  console.log(`  Atlas:     ${atlasUrl}`);
  console.log(`  Auth:      ${accessToken ? 'OAuth2 token' : 'API key'}${refreshToken ? ' + refresh' : ''}`);
  console.log(`  Lookback:  ${lookbackDays} days`);
  console.log(`  Mode:      ${pollMode ? 'sync + poll' : 'one-time sync'}`);
  console.log('');

  const timeMin = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  syncCalendars(calendarIds, atlasUrl, {
    tokenHolder,
    apiKey,
    timeMin,
  })
    .then((summary) => {
      console.log('');
      console.log('=== Sync Summary ===');
      console.log(`  Events found:    ${summary.eventsFound}`);
      console.log(`  Events created:  ${summary.eventsCreated}`);
      console.log(`  Errors:          ${summary.errors.length}`);
      console.log(`  Duration:        ${(summary.durationMs / 1000).toFixed(1)}s`);

      if (summary.errors.length > 0) {
        console.log('');
        console.log('  Failed events:');
        for (const { eventId, error } of summary.errors) {
          console.log(`    - ${eventId}: ${error}`);
        }
      }

      if (pollMode) {
        console.log('');
        console.log('Starting periodic polling (Ctrl+C to stop)...');
        const poller = startPolling(calendarIds, atlasUrl, {
          tokenHolder,
          apiKey,
          intervalMs: pollIntervalMs,
        });

        const shutdown = (): void => {
          console.log('\nShutting down poller...');
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
