import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../db/connection.js';
import { createEvent, listEvents } from '../events.js';
import * as eventsModule from '../events.js';
import { listNodes } from '../graph/nodes.js';

const { analyzeEventMock, isLlmAvailableMock } = vi.hoisted(() => ({
  analyzeEventMock: vi.fn(),
  isLlmAvailableMock: vi.fn(),
}));

vi.mock('./llm.js', () => ({
  analyzeEvent: analyzeEventMock,
  isLlmAvailable: isLlmAvailableMock,
}));

import { consolidate } from './consolidate.js';

describe('consolidate', () => {
  beforeEach(() => {
    analyzeEventMock.mockReset();
    isLlmAvailableMock.mockReset();
    isLlmAvailableMock.mockReturnValue(false);
  });

  it('rolls back mid-event LLM write failures and retries cleanly', async () => {
    const { event } = createEvent({
      type: 'observation',
      source: 'test',
      content: JSON.stringify({
        title: 'Atomic Event',
        content: 'Captured once',
      }),
    });

    isLlmAvailableMock.mockReturnValue(true);
    analyzeEventMock.mockResolvedValue({
      action: 'create',
      title: 'Atomic Event',
      summary: 'summary',
      type: 'concept',
      tags: ['atomic'],
      edges: [],
    });

    const originalCreateEvent = eventsModule.createEvent;
    const createEventSpy = vi
      .spyOn(eventsModule, 'createEvent')
      .mockImplementation((input) => {
        if (input.type === 'archivist_action') {
          throw new Error('simulated mid-write failure');
        }

        return originalCreateEvent(input);
      });

    await expect(consolidate()).rejects.toThrow('simulated mid-write failure');

    const db = getDb();
    const processedRow = db
      .prepare('SELECT processed_at FROM events WHERE id = ?')
      .get(event.id) as { processed_at: string | null };

    expect(processedRow.processed_at).toBeNull();
    expect(listNodes()).toHaveLength(0);
    expect(listEvents({ type: 'archivist_action' })).toHaveLength(0);

    createEventSpy.mockRestore();

    const result = await consolidate();

    expect(result.processed).toBe(1);
    expect(result.nodesCreated).toBe(1);
    expect(result.nodesUpdated).toBe(0);
    expect(result.edgesCreated).toBe(0);

    const [node] = listNodes();
    expect(node.title).toBe('Atomic Event');
    expect(node.content).toBe('Captured once');

    const actionEvents = listEvents({ type: 'archivist_action' });
    expect(actionEvents).toHaveLength(1);
    expect(JSON.parse(actionEvents[0].content)).toMatchObject({
      action: 'create',
      event_id: event.id,
      method: 'llm',
    });
  });

  it('falls back to FTS when LLM analysis fails before writes begin', async () => {
    createEvent({
      type: 'observation',
      source: 'test',
      content: JSON.stringify({
        title: 'Fallback Event',
        content: 'Use FTS instead',
      }),
    });

    isLlmAvailableMock.mockReturnValue(true);
    analyzeEventMock.mockRejectedValue(new Error('analysis failed'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await consolidate();

    expect(result.processed).toBe(1);
    expect(result.nodesCreated).toBe(1);
    expect(result.nodesUpdated).toBe(0);

    const [actionEvent] = listEvents({ type: 'archivist_action' });
    expect(JSON.parse(actionEvent.content)).toMatchObject({
      action: 'create',
      method: 'fts',
    });

    consoleErrorSpy.mockRestore();
  });
});
