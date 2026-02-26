#!/usr/bin/env node

/**
 * Claude Code Conversations Collector CLI for Atlas
 *
 * Usage:
 *   npx tsx src/collectors/run-claude-code.ts
 *
 * Environment variables:
 *   CLAUDE_DIR  - path to Claude Code config directory (default: ~/.claude)
 *   ATLAS_URL   - Atlas API base URL (default: http://localhost:3001)
 */

import os from 'node:os';
import path from 'node:path';
import { importConversations } from './claude-code.js';

const DEFAULT_CLAUDE_DIR = path.join(os.homedir(), '.claude');
const DEFAULT_ATLAS_URL = 'http://localhost:3001';

function main(): void {
  const claudeDir = process.env['CLAUDE_DIR'] ?? DEFAULT_CLAUDE_DIR;
  const atlasUrl = process.env['ATLAS_URL'] ?? DEFAULT_ATLAS_URL;

  console.log('=== Claude Code Conversations Collector for Atlas ===');
  console.log(`  Claude dir: ${claudeDir}`);
  console.log(`  Atlas:      ${atlasUrl}`);
  console.log('');

  importConversations(claudeDir, atlasUrl)
    .then((summary) => {
      console.log('');
      console.log('=== Import Summary ===');
      console.log(`  Conversations scanned: ${summary.conversationsScanned}`);
      console.log(`  Events created:        ${summary.eventsCreated}`);
      console.log(`  Errors:                ${summary.errors.length}`);
      console.log(`  Duration:              ${(summary.durationMs / 1000).toFixed(1)}s`);

      if (summary.errors.length > 0) {
        console.log('');
        console.log('  Failed files:');
        for (const { file, error } of summary.errors) {
          console.log(`    - ${file}: ${error}`);
        }
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Fatal error: ${message}`);
      process.exit(1);
    });
}

main();
