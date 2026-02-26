import type { CreateEventInput } from '../types.js';

// --- Types ---

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string;          // ISO string
  end: string;            // ISO string
  status: string;         // 'confirmed' | 'tentative' | 'cancelled'
  attendees: string[];
  organizer: string | null;
  calendarId: string;
  htmlLink: string | null;
  updated: string;        // ISO string — last modified time from Google
}

export interface SyncSummary {
  eventsFound: number;
  eventsCreated: number;
  errors: Array<{ eventId: string; error: string }>;
  durationMs: number;
}

/** Shape of a single event from the Google Calendar API. */
interface GCalApiEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  attendees?: Array<{ email?: string }>;
  organizer?: { email?: string };
  htmlLink?: string;
  updated?: string;
}

/** Shape of the calendar list response from the Google Calendar API. */
interface GCalListResponse {
  items?: GCalApiEvent[];
  nextPageToken?: string;
}

// --- Google Calendar API ---

const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Mutable token holder. When a refresh is performed, the access token
 * is updated in-place so that all subsequent requests use the new token.
 */
export interface TokenHolder {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Refresh an expired OAuth2 access token using a refresh token.
 * Mutates the holder in-place and returns the new access token.
 */
export async function refreshAccessToken(holder: TokenHolder): Promise<string> {
  if (!holder.refreshToken || !holder.clientId || !holder.clientSecret) {
    throw new Error(
      'Cannot refresh access token: GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET are all required',
    );
  }

  console.log('  Access token expired, refreshing...');

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: holder.refreshToken,
      client_id: holder.clientId,
      client_secret: holder.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  holder.accessToken = data.access_token;
  console.log('  Access token refreshed successfully');
  return data.access_token;
}

/**
 * Build authorization headers based on available credentials.
 * Supports OAuth2 access tokens or API keys (via query param).
 */
function buildAuthHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  return headers;
}

/**
 * Append API key to URL if provided (for API key auth mode).
 */
function withApiKey(url: string, apiKey?: string): string {
  if (!apiKey) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(apiKey)}`;
}

// --- Fetching ---

/**
 * Fetch events from a single Google Calendar.
 * Paginates through all results.
 * On 401, attempts to refresh the access token and retry once.
 */
export async function fetchCalendarEvents(
  calendarId: string,
  options: {
    tokenHolder: TokenHolder;
    apiKey?: string;
    timeMin?: string;    // ISO string — only events after this time
    timeMax?: string;    // ISO string — only events before this time
    maxResults?: number;
  },
): Promise<CalendarEvent[]> {
  const { tokenHolder, apiKey, timeMin, timeMax, maxResults = 250 } = options;
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(Math.min(maxResults, 2500)),
    });

    if (timeMin) params.set('timeMin', timeMin);
    if (timeMax) params.set('timeMax', timeMax);
    if (pageToken) params.set('pageToken', pageToken);

    const url = withApiKey(
      `${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      apiKey,
    );

    let response = await fetch(url, {
      headers: buildAuthHeaders(tokenHolder.accessToken),
    });

    // On 401, attempt token refresh and retry once
    if (response.status === 401 && tokenHolder.refreshToken) {
      await refreshAccessToken(tokenHolder);
      response = await fetch(url, {
        headers: buildAuthHeaders(tokenHolder.accessToken),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as GCalListResponse;

    for (const item of data.items ?? []) {
      if (!item.id) continue;

      const startStr = item.start?.dateTime ?? item.start?.date ?? '';
      const endStr = item.end?.dateTime ?? item.end?.date ?? '';

      events.push({
        id: item.id,
        summary: item.summary ?? '(No title)',
        description: item.description ?? null,
        location: item.location ?? null,
        start: startStr,
        end: endStr,
        status: item.status ?? 'confirmed',
        attendees: (item.attendees ?? [])
          .map((a) => a.email)
          .filter((e): e is string => typeof e === 'string'),
        organizer: item.organizer?.email ?? null,
        calendarId,
        htmlLink: item.htmlLink ?? null,
        updated: item.updated ?? '',
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

// --- Event transformation ---

/**
 * Classify a calendar event as a node type hint for the Archivist.
 */
function classifyEvent(event: CalendarEvent): string {
  const summary = event.summary.toLowerCase();
  if (summary.includes('deadline') || summary.includes('due')) return 'deadline';
  if (summary.includes('meeting') || event.attendees.length > 0) return 'meeting';
  if (summary.includes('appointment') || summary.includes('appt')) return 'appointment';
  return 'event';
}

/**
 * Transform a Google Calendar event into a CreateEventInput for the Atlas API.
 */
export function calendarEventToAtlasEvent(event: CalendarEvent): CreateEventInput {
  const eventKind = classifyEvent(event);

  const contentParts: string[] = [];
  if (event.description) contentParts.push(event.description);
  if (event.location) contentParts.push(`Location: ${event.location}`);
  if (event.attendees.length > 0) contentParts.push(`Attendees: ${event.attendees.join(', ')}`);

  const content = JSON.stringify({
    title: event.summary,
    body: contentParts.join('\n') || event.summary,
    tags: ['calendar', eventKind],
    metadata: {
      googleEventId: event.id,
      calendarId: event.calendarId,
      start: event.start,
      end: event.end,
      location: event.location,
      attendees: event.attendees,
      organizer: event.organizer,
      status: event.status,
      htmlLink: event.htmlLink,
      eventKind,
    },
  });

  return {
    type: 'observation',
    source: 'google-calendar',
    content,
    metadata: {
      googleEventId: event.id,
      calendarId: event.calendarId,
      start: event.start,
      end: event.end,
      location: event.location,
      attendees: event.attendees,
      organizer: event.organizer,
      status: event.status,
      htmlLink: event.htmlLink,
      eventKind,
      updated: event.updated,
    },
    idempotency_key: `gcal:${event.calendarId}:${event.id}:${event.updated}`,
  };
}

// --- Sync ---

/**
 * Sync events from one or more Google Calendars into Atlas.
 */
export async function syncCalendars(
  calendarIds: string[],
  atlasUrl: string,
  options: {
    tokenHolder: TokenHolder;
    apiKey?: string;
    timeMin?: string;
    timeMax?: string;
  },
): Promise<SyncSummary> {
  const start = Date.now();
  const summary: SyncSummary = {
    eventsFound: 0,
    eventsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  const eventsUrl = `${atlasUrl.replace(/\/$/, '')}/events`;

  for (const calendarId of calendarIds) {
    console.log(`Fetching events from calendar: ${calendarId}`);

    let events: CalendarEvent[];
    try {
      events = await fetchCalendarEvents(calendarId, {
        tokenHolder: options.tokenHolder,
        apiKey: options.apiKey,
        timeMin: options.timeMin,
        timeMax: options.timeMax,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Error fetching calendar ${calendarId}: ${message}`);
      summary.errors.push({ eventId: `calendar:${calendarId}`, error: message });
      continue;
    }

    console.log(`  Found ${events.length} events`);
    summary.eventsFound += events.length;

    for (const event of events) {
      try {
        const atlasEvent = calendarEventToAtlasEvent(event);

        const response = await fetch(eventsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(atlasEvent),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        summary.eventsCreated++;

        if (summary.eventsCreated % 50 === 0) {
          console.log(`  Progress: ${summary.eventsCreated} events created`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ eventId: event.id, error: message });
        console.error(`  Error processing event ${event.id}: ${message}`);
      }
    }
  }

  summary.durationMs = Date.now() - start;
  return summary;
}

// --- Polling ---

/**
 * Start periodic sync of Google Calendar events.
 * Polls for new/changed events at the given interval.
 * The tokenHolder is shared so that refreshed tokens persist across polls.
 *
 * Returns an object with a stop() method to cancel polling.
 */
export function startPolling(
  calendarIds: string[],
  atlasUrl: string,
  options: {
    tokenHolder: TokenHolder;
    apiKey?: string;
    intervalMs?: number;
  },
): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000; // default: 5 minutes
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  // Track last sync time so we only fetch new/changed events
  let lastSyncTime = new Date().toISOString();

  async function poll(): Promise<void> {
    if (running) {
      console.log('  Poll skipped — previous sync still running');
      return;
    }

    running = true;
    const syncStart = lastSyncTime;
    lastSyncTime = new Date().toISOString();

    try {
      console.log(`\nPolling for changes since ${syncStart}...`);
      const summary = await syncCalendars(calendarIds, atlasUrl, {
        tokenHolder: options.tokenHolder,
        apiKey: options.apiKey,
        timeMin: syncStart,
      });
      console.log(`  Poll complete: ${summary.eventsCreated} new events, ${summary.errors.length} errors`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Poll error: ${message}`);
    } finally {
      running = false;
    }
  }

  timer = setInterval(() => {
    poll().catch(() => {});
  }, intervalMs);
  console.log(`Polling every ${intervalMs / 1000}s for calendar changes...`);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log('Polling stopped.');
    },
  };
}
