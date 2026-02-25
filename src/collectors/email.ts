import fs from 'node:fs';
import path from 'node:path';
import type { CreateEventInput } from '../types.js';

// --- Types ---

export interface EmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  anthropicApiKey: string;
  atlasUrl: string;
  labels?: string[];
  senders?: string[];
  importance?: boolean;
  after?: string;
  stateDir?: string;
}

export interface EmailThread {
  id: string;
  subject: string;
  participants: string[];
  labels: string[];
  messages: EmailMessage[];
  date: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
  body: string;
}

export interface ImportSummary {
  threadsScanned: number;
  eventsCreated: number;
  errors: Array<{ threadId: string; error: string }>;
  durationMs: number;
}

// --- Gmail API response types ---

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

interface GmailThreadResponse {
  id: string;
  messages: GmailMessage[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailPayload;
  internalDate: string;
}

interface GmailPayload {
  headers: Array<{ name: string; value: string }>;
  mimeType: string;
  body: { size: number; data?: string };
  parts?: GmailPart[];
}

interface GmailPart {
  mimeType: string;
  body: { size: number; data?: string };
  parts?: GmailPart[];
}

// --- Gmail OAuth2 ---

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth2 token refresh failed: HTTP ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

// --- Gmail API helpers ---

export function buildSearchQuery(config: EmailConfig, afterDate?: string): string {
  const parts: string[] = [];

  if (config.labels) {
    for (const label of config.labels) {
      parts.push(`label:${label}`);
    }
  }

  if (config.senders) {
    const fromClauses = config.senders.map(s => `from:${s}`);
    if (fromClauses.length === 1) {
      parts.push(fromClauses[0]);
    } else if (fromClauses.length > 1) {
      parts.push(`{${fromClauses.join(' ')}}`);
    }
  }

  if (config.importance) {
    parts.push('is:important');
  }

  const dateFilter = afterDate ?? config.after;
  if (dateFilter) {
    const d = new Date(dateFilter);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      parts.push(`after:${yyyy}/${mm}/${dd}`);
    }
  }

  return parts.join(' ');
}

async function listMessageIds(
  accessToken: string,
  query: string,
  maxResults: number = 100,
): Promise<Array<{ id: string; threadId: string }>> {
  const allMessages: Array<{ id: string; threadId: string }> = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults),
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gmail list messages failed: HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as GmailListResponse;
    if (data.messages) {
      allMessages.push(...data.messages);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allMessages;
}

async function getThread(
  accessToken: string,
  threadId: string,
): Promise<GmailThreadResponse> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail get thread failed: HTTP ${response.status}: ${text}`);
  }

  return (await response.json()) as GmailThreadResponse;
}

// --- Message body extraction ---

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextFromParts(parts: GmailPart[]): string {
  // Prefer text/plain
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      const text = extractTextFromParts(part.parts);
      if (text) return text;
    }
  }
  // Fallback to text/html
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body.data) {
      return stripHtml(decodeBase64Url(part.body.data));
    }
    if (part.parts) {
      for (const nested of part.parts) {
        if (nested.mimeType === 'text/html' && nested.body.data) {
          return stripHtml(decodeBase64Url(nested.body.data));
        }
      }
    }
  }
  return '';
}

function getHeader(message: GmailMessage, name: string): string {
  const header = message.payload.headers.find(
    h => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? '';
}

function extractMessageBody(message: GmailMessage): string {
  if (message.payload.body.data) {
    return decodeBase64Url(message.payload.body.data);
  }
  if (message.payload.parts) {
    return extractTextFromParts(message.payload.parts);
  }
  return message.snippet;
}

// --- Thread parsing ---

export function parseThread(gmailThread: GmailThreadResponse): EmailThread {
  const messages: EmailMessage[] = gmailThread.messages.map(msg => ({
    id: msg.id,
    from: getHeader(msg, 'From'),
    to: getHeader(msg, 'To').split(',').map(s => s.trim()).filter(Boolean),
    date: new Date(parseInt(msg.internalDate, 10)).toISOString(),
    snippet: msg.snippet,
    body: extractMessageBody(msg),
  }));

  messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const firstMessage = gmailThread.messages[0];
  const lastMessage = messages[messages.length - 1];
  const subject = getHeader(firstMessage, 'Subject') || '(no subject)';

  const participantSet = new Set<string>();
  for (const msg of messages) {
    participantSet.add(msg.from);
    for (const to of msg.to) {
      participantSet.add(to);
    }
  }

  const labelSet = new Set<string>();
  for (const msg of gmailThread.messages) {
    for (const label of msg.labelIds) {
      labelSet.add(label);
    }
  }

  return {
    id: gmailThread.id,
    subject,
    participants: [...participantSet],
    labels: [...labelSet],
    messages,
    date: lastMessage.date,
  };
}

// --- LLM summarization ---

function buildThreadText(thread: EmailThread): string {
  const parts: string[] = [
    `Subject: ${thread.subject}`,
    `Participants: ${thread.participants.join(', ')}`,
    `Messages: ${thread.messages.length}`,
    '',
  ];

  for (const msg of thread.messages) {
    parts.push(`--- From: ${msg.from} | Date: ${msg.date} ---`);
    const body = msg.body.length > 2000 ? msg.body.slice(0, 2000) + '...' : msg.body;
    parts.push(body);
    parts.push('');
  }

  return parts.join('\n');
}

async function summarizeThread(
  thread: EmailThread,
  anthropicApiKey: string,
): Promise<string> {
  const threadText = buildThreadText(thread);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Summarize this email thread concisely. Focus on key decisions, action items, and important information. Keep it to 2-4 sentences.\n\n${threadText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API failed: HTTP ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = data.content.find(c => c.type === 'text');
  return textBlock?.text ?? '';
}

// --- Event transformation ---

export function threadToEvent(thread: EmailThread, summary: string): CreateEventInput {
  const content = JSON.stringify({
    title: thread.subject,
    body: summary,
    tags: thread.labels.map(l => l.toLowerCase().replace(/^category_/i, '')),
    participants: thread.participants,
    threadId: thread.id,
    date: thread.date,
  });

  return {
    type: 'observation',
    source: 'email',
    content,
    metadata: {
      threadId: thread.id,
      messageCount: thread.messages.length,
      participants: thread.participants,
      labels: thread.labels,
      date: thread.date,
    },
  };
}

// --- State tracking ---

interface CollectorState {
  lastImportedAt: string;
}

function getStateFilePath(stateDir: string): string {
  return path.join(stateDir, 'email-collector-state.json');
}

function loadState(stateDir: string): CollectorState | null {
  const stateFile = getStateFilePath(stateDir);
  if (!fs.existsSync(stateFile)) return null;
  try {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(raw) as CollectorState;
  } catch {
    return null;
  }
}

function saveState(stateDir: string, state: CollectorState): void {
  const stateFile = getStateFilePath(stateDir);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// --- Batch import ---

export async function importEmails(config: EmailConfig): Promise<ImportSummary> {
  const start = Date.now();
  const summary: ImportSummary = {
    threadsScanned: 0,
    eventsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  const stateDir = config.stateDir ?? './data';
  const state = loadState(stateDir);
  const afterDate = state?.lastImportedAt ?? config.after;

  console.log('Refreshing access token...');
  const accessToken = await refreshAccessToken(
    config.clientId,
    config.clientSecret,
    config.refreshToken,
  );

  const query = buildSearchQuery(config, afterDate);
  console.log(`Search query: ${query || '(all mail)'}`);

  console.log('Fetching message list...');
  const messages = await listMessageIds(accessToken, query);

  const threadIds = [...new Set(messages.map(m => m.threadId))];
  console.log(`Found ${messages.length} messages in ${threadIds.length} threads`);
  summary.threadsScanned = threadIds.length;

  const eventsUrl = `${config.atlasUrl.replace(/\/$/, '')}/events`;

  for (const threadId of threadIds) {
    try {
      const gmailThread = await getThread(accessToken, threadId);
      const thread = parseThread(gmailThread);

      const threadSummary = await summarizeThread(thread, config.anthropicApiKey);

      const event = threadToEvent(thread, threadSummary);

      const response = await fetch(eventsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      summary.eventsCreated++;

      if (summary.eventsCreated % 10 === 0) {
        console.log(`  Progress: ${summary.eventsCreated}/${threadIds.length} threads processed`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ threadId, error: message });
      console.error(`  Error processing thread ${threadId}: ${message}`);
    }
  }

  saveState(stateDir, { lastImportedAt: new Date().toISOString() });

  summary.durationMs = Date.now() - start;
  return summary;
}

// --- Poll mode ---

export function pollEmails(
  config: EmailConfig,
  intervalMs: number = 300_000,
): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = true;

  console.log(`Polling for new emails every ${intervalMs / 1000}s...`);

  async function runOnce(): Promise<void> {
    if (!running) return;

    try {
      const summary = await importEmails(config);
      if (summary.eventsCreated > 0) {
        console.log(`  Poll: ${summary.eventsCreated} new threads imported`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Poll error: ${message}`);
    }

    if (running) {
      timer = setTimeout(runOnce, intervalMs);
    }
  }

  timer = setTimeout(runOnce, intervalMs);

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
