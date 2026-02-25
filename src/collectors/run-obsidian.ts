#!/usr/bin/env node

/**
 * Obsidian Collector CLI for Atlas
 *
 * Usage:
 *   npx tsx src/collectors/run-obsidian.ts          # batch import
 *   npx tsx src/collectors/run-obsidian.ts --watch   # batch import + watch
 *
 * Environment variables:
 *   VAULT_PATH  - path to Obsidian vault (default: see below)
 *   ATLAS_URL   - Atlas API base URL (default: http://localhost:3001)
 */

import { importVault, watchVault } from './obsidian.js';

const DEFAULT_VAULT_PATH = process.platform === 'win32'
  ? 'C:\\Users\\josh\\OneDrive\\Documents\\Obsidian\\Obsidian Vault'
  : '/mnt/c/Users/josh/OneDrive/Documents/Obsidian/Obsidian Vault';
const DEFAULT_ATLAS_URL = 'http://localhost:3001';

function main(): void {
  const vaultPath = process.env['VAULT_PATH'] ?? DEFAULT_VAULT_PATH;
  const atlasUrl = process.env['ATLAS_URL'] ?? DEFAULT_ATLAS_URL;
  const watchMode = process.argv.includes('--watch');

  console.log('=== Obsidian Collector for Atlas ===');
  console.log(`  Vault:  ${vaultPath}`);
  console.log(`  Atlas:  ${atlasUrl}`);
  console.log(`  Mode:   ${watchMode ? 'batch import + watch' : 'batch import'}`);
  console.log('');

  // Run batch import, then optionally start watcher
  importVault(vaultPath, atlasUrl)
    .then((summary) => {
      console.log('');
      console.log('=== Import Summary ===');
      console.log(`  Files scanned:   ${summary.filesScanned}`);
      console.log(`  Events created:  ${summary.eventsCreated}`);
      console.log(`  Errors:          ${summary.errors.length}`);
      console.log(`  Duration:        ${(summary.durationMs / 1000).toFixed(1)}s`);

      if (summary.errors.length > 0) {
        console.log('');
        console.log('  Failed files:');
        for (const { file, error } of summary.errors) {
          console.log(`    - ${file}: ${error}`);
        }
      }

      if (summary.filesScanned === 0 && !watchMode) {
        console.error('');
        console.error('Error: zero files scanned — verify VAULT_PATH is correct');
        process.exit(1);
      }

      if (watchMode) {
        console.log('');
        console.log('Starting file watcher (Ctrl+C to stop)...');
        const watcher = watchVault(vaultPath, atlasUrl);

        // Graceful shutdown on SIGINT/SIGTERM
        const shutdown = (): void => {
          console.log('\nShutting down watcher...');
          watcher.close().then(() => process.exit(0));
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
