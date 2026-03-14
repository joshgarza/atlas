import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const nginxConfigPath = fileURLToPath(new URL('../../ui/nginx.conf', import.meta.url));
const nginxConfig = readFileSync(nginxConfigPath, 'utf8');

function getApiLocationBlock(config: string): string {
  const match = config.match(/location \/api\/ \{([\s\S]*?)\n    \}/);
  if (!match) {
    throw new Error('Missing /api/ location block in ui/nginx.conf');
  }

  return match[1];
}

describe('ui nginx config', () => {
  it('pins API proxy timeouts to five minutes', () => {
    const apiLocationBlock = getApiLocationBlock(nginxConfig);

    assert.match(apiLocationBlock, /proxy_connect_timeout 300s;/);
    assert.match(apiLocationBlock, /proxy_send_timeout 300s;/);
    assert.match(apiLocationBlock, /proxy_read_timeout 300s;/);
  });
});
