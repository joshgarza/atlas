import { describe, it, expect } from 'vitest';
import { createEvent, listEvents } from './events.js';

describe('createEvent', () => {
  it('creates an event with required fields', () => {
    const event = createEvent({
      type: 'observation',
      source: 'test',
      content: 'something happened',
    });

    expect(event.id).toBeTruthy();
    expect(event.type).toBe('observation');
    expect(event.source).toBe('test');
    expect(event.content).toBe('something happened');
    expect(event.metadata).toBeNull();
    expect(event.created_at).toBeTruthy();
  });

  it('creates an event with metadata', () => {
    const event = createEvent({
      type: 'query',
      source: 'api',
      content: 'search query',
      metadata: { query: 'test', results: 5 },
    });

    expect(event.metadata).toEqual({ query: 'test', results: 5 });
  });

  it('populates content_hash automatically', () => {
    const event = createEvent({
      type: 'observation',
      source: 'test',
      content: 'hash me',
    });

    expect(event.content_hash).toBeTruthy();
    expect(event.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces consistent content_hash for same content', () => {
    const e1 = createEvent({ type: 'observation', source: 'a', content: 'same content' });
    const e2 = createEvent({ type: 'observation', source: 'b', content: 'same content' });

    expect(e1.content_hash).toBe(e2.content_hash);
  });

  it('returns existing event for duplicate idempotency_key', () => {
    const first = createEvent({
      type: 'observation',
      source: 'test',
      content: 'original',
      idempotency_key: 'key-1',
    });

    const second = createEvent({
      type: 'observation',
      source: 'test',
      content: 'duplicate attempt',
      idempotency_key: 'key-1',
    });

    expect(second.id).toBe(first.id);
    expect(second.content).toBe('original');
    expect(second.deduplicated).toBe(true);
  });

  it('allows duplicate content when idempotency_key is null', () => {
    const e1 = createEvent({ type: 'observation', source: 'a', content: 'same content' });
    const e2 = createEvent({ type: 'observation', source: 'a', content: 'same content' });

    expect(e1.id).not.toBe(e2.id);
    expect(e1.content_hash).toBe(e2.content_hash);
  });

  it('stores idempotency_key when provided', () => {
    const event = createEvent({
      type: 'observation',
      source: 'gcal',
      content: 'meeting notes',
      idempotency_key: 'gcal:abc123',
    });

    expect(event.idempotency_key).toBe('gcal:abc123');
  });

  it('sets idempotency_key to null when not provided', () => {
    const event = createEvent({
      type: 'observation',
      source: 'test',
      content: 'no key',
    });

    expect(event.idempotency_key).toBeNull();
  });
});

describe('listEvents', () => {
  it('returns events in reverse chronological order', () => {
    const e1 = createEvent({ type: 'observation', source: 'a', content: 'first' });
    const e2 = createEvent({ type: 'observation', source: 'a', content: 'second' });

    const events = listEvents();
    expect(events.length).toBe(2);
    expect(events[0].id).toBe(e2.id);
    expect(events[1].id).toBe(e1.id);
  });

  it('filters by type', () => {
    createEvent({ type: 'observation', source: 'a', content: 'obs' });
    createEvent({ type: 'query', source: 'a', content: 'query' });

    const observations = listEvents({ type: 'observation' });
    expect(observations.length).toBe(1);
    expect(observations[0].type).toBe('observation');
  });

  it('supports pagination', () => {
    for (let i = 0; i < 5; i++) {
      createEvent({ type: 'observation', source: 'a', content: `event ${i}` });
    }

    const page1 = listEvents({ limit: 2, offset: 0 });
    const page2 = listEvents({ limit: 2, offset: 2 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('returns empty array when no events exist', () => {
    const events = listEvents();
    expect(events).toEqual([]);
  });

  it('deserializes metadata from JSON', () => {
    createEvent({
      type: 'observation',
      source: 'test',
      content: 'with meta',
      metadata: { key: 'value' },
    });

    const events = listEvents();
    expect(events[0].metadata).toEqual({ key: 'value' });
  });
});
