import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AdvancedSearchQuerySchema, EdgeListQuerySchema, NodeListQuerySchema } from '../schemas.js';

describe('query schemas', () => {
  it('rejects empty offset for node list queries', () => {
    const result = NodeListQuerySchema.safeParse({ offset: '' });

    assert.equal(result.success, false);
  });

  it('rejects whitespace-only offset for edge list queries', () => {
    const result = EdgeListQuerySchema.safeParse({ offset: '   ' });

    assert.equal(result.success, false);
  });

  it('rejects empty offset for advanced search queries', () => {
    const result = AdvancedSearchQuerySchema.safeParse({ offset: '' });

    assert.equal(result.success, false);
  });

  it('parses trimmed non-empty offsets as numbers', () => {
    const result = AdvancedSearchQuerySchema.parse({ offset: ' 0 ' });

    assert.equal(result.offset, 0);
  });

  it('filters empty tag entries in advanced search queries', () => {
    const result = AdvancedSearchQuerySchema.parse({ tags: 'alpha,,beta,' });

    assert.deepEqual(result.tags, ['alpha', 'beta']);
  });

  it('trims whitespace-only tag entries in advanced search queries', () => {
    const result = AdvancedSearchQuerySchema.parse({ tags: ' alpha,  , beta , ' });

    assert.deepEqual(result.tags, ['alpha', 'beta']);
  });

  it('treats an empty tags query as an empty list', () => {
    const result = AdvancedSearchQuerySchema.parse({ tags: '' });

    assert.deepEqual(result.tags, []);
  });
});
