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
