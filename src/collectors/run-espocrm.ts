#!/usr/bin/env node

/**
 * EspoCRM Collector CLI for Atlas
 *
 * Usage:
 *   npx tsx src/collectors/run-espocrm.ts
 *
 * Environment variables:
 *   ESPOCRM_URL    - EspoCRM instance base URL (required)
 *   ESPOCRM_API_KEY - EspoCRM API key (required)
 *   ATLAS_URL      - Atlas API base URL (default: http://localhost:3001)
 */

import { importEntities } from './espocrm.js';

const DEFAULT_ATLAS_URL = 'http://localhost:3001';

function main(): void {
  const espoUrl = process.env['ESPOCRM_URL'];
  const apiKey = process.env['ESPOCRM_API_KEY'];
  const atlasUrl = process.env['ATLAS_URL'] ?? DEFAULT_ATLAS_URL;

  if (!espoUrl) {
    console.error('Error: ESPOCRM_URL environment variable is required');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('Error: ESPOCRM_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('=== EspoCRM Collector for Atlas ===');
  console.log(`  EspoCRM: ${espoUrl}`);
  console.log(`  Atlas:   ${atlasUrl}`);
  console.log('');

  importEntities({ baseUrl: espoUrl, apiKey }, atlasUrl)
    .then((summary) => {
      console.log('');
      console.log('=== Import Summary ===');
      console.log(`  Entities fetched: ${summary.entitiesFetched}`);
      console.log(`  Events created:   ${summary.eventsCreated}`);
      console.log(`  Errors:           ${summary.errors.length}`);
      console.log(`  Duration:         ${(summary.durationMs / 1000).toFixed(1)}s`);

      if (summary.errors.length > 0) {
        console.log('');
        console.log('  Failed entities:');
        for (const { entity, error } of summary.errors) {
          console.log(`    - ${entity}: ${error}`);
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
