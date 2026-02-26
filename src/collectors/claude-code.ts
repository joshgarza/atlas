import fs from 'node:fs';
import path from 'node:path';
import type { CreateEventInput } from '../types.js';

// --- Types ---

/** A single message entry from a Claude Code JSONL conversation file. */
interface ConversationEntry {
  type: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    model?: string;
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Parsed conversation with extracted content. */
export interface ParsedConversation {
  sessionId: string;
  project: string;
  startedAt: string;
  endedAt: string;
  model: string | null;
  gitBranch: string | null;
  cwd: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  turns: ConversationTurn[];
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface ImportSummary {
  conversationsScanned: number;
  eventsCreated: number;
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
}

/** Maximum body length per event to keep DB manageable. */
const MAX_BODY_LENGTH = 50_000;

// --- Parsing ---

/**
 * Extract the project name from a Claude Code projects directory name.
 * Directory names use dashes for path separators, e.g. "-home-josh-coding-atlas"
 */
function projectFromDirName(dirName: string): string {
  // Strip leading dash, split on dashes, take the last meaningful segment
  const parts = dirName.replace(/^-/, '').split('-');
  // Use the last 1-2 parts as the project name
  if (parts.length >= 2) {
    return parts.slice(-2).join('-');
  }
  return parts[parts.length - 1] || dirName;
}

/**
 * Extract text content from a message's content field.
 * Handles both string content (user messages) and content block arrays (assistant messages).
 * Skips thinking blocks and tool_use blocks.
 */
function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';

  if (typeof content === 'string') return content;

  const texts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      texts.push(block.text);
    }
  }
  return texts.join('\n');
}

/**
 * Parse a Claude Code JSONL conversation file into structured data.
 */
export function parseConversation(filePath: string, projectDir: string): ParsedConversation {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());

  const sessionId = path.basename(filePath, '.jsonl');
  const project = projectFromDirName(path.basename(projectDir));

  let startedAt = '';
  let endedAt = '';
  let model: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const turns: ConversationTurn[] = [];

  for (const line of lines) {
    let entry: ConversationEntry;
    try {
      entry = JSON.parse(line) as ConversationEntry;
    } catch {
      continue;
    }

    const ts = entry.timestamp;
    if (ts) {
      if (!startedAt) startedAt = ts;
      endedAt = ts;
    }

    if (entry.gitBranch && !gitBranch) {
      gitBranch = entry.gitBranch;
    }
    if (entry.cwd && !cwd) {
      cwd = entry.cwd;
    }

    if (entry.type === 'user') {
      const text = extractText(entry.message?.content);
      if (text) {
        userMessageCount++;
        turns.push({
          role: 'user',
          text,
          timestamp: ts || '',
        });
      }
    }

    if (entry.type === 'assistant') {
      if (!model && entry.message?.model) {
        model = entry.message.model;
      }

      const text = extractText(entry.message?.content);
      if (text) {
        assistantMessageCount++;
        turns.push({
          role: 'assistant',
          text,
          timestamp: ts || '',
        });
      }
    }
  }

  return {
    sessionId,
    project,
    startedAt,
    endedAt,
    model,
    gitBranch,
    cwd,
    userMessageCount,
    assistantMessageCount,
    turns,
  };
}

// --- Event transformation ---

/**
 * Build a readable conversation transcript from turns.
 * Truncates to MAX_BODY_LENGTH to keep events manageable.
 */
function buildTranscript(turns: ConversationTurn[]): string {
  const parts: string[] = [];
  let length = 0;

  for (const turn of turns) {
    const prefix = turn.role === 'user' ? '## User' : '## Assistant';
    const segment = `${prefix}\n${turn.text}\n`;

    if (length + segment.length > MAX_BODY_LENGTH) {
      const remaining = MAX_BODY_LENGTH - length;
      if (remaining > 100) {
        parts.push(segment.slice(0, remaining) + '\n\n[truncated]');
      }
      break;
    }

    parts.push(segment);
    length += segment.length;
  }

  return parts.join('\n');
}

/**
 * Transform a parsed conversation into a CreateEventInput for the Atlas API.
 */
export function conversationToEvent(conversation: ParsedConversation): CreateEventInput {
  const body = buildTranscript(conversation.turns);

  const dateLabel = conversation.startedAt ? conversation.startedAt.slice(0, 10) : 'unknown';
  const title = `Claude Code session: ${conversation.project} (${dateLabel})`;

  const tags = ['claude-code', conversation.project];
  if (conversation.gitBranch) {
    tags.push(conversation.gitBranch);
  }

  const content = JSON.stringify({
    title,
    body,
    tags,
  });

  return {
    type: 'observation',
    source: 'claude-code',
    content,
    metadata: {
      sessionId: conversation.sessionId,
      project: conversation.project,
      startedAt: conversation.startedAt,
      endedAt: conversation.endedAt,
      model: conversation.model,
      gitBranch: conversation.gitBranch,
      cwd: conversation.cwd,
      userMessageCount: conversation.userMessageCount,
      assistantMessageCount: conversation.assistantMessageCount,
      tags,
    },
    idempotency_key: `claude-code:${conversation.sessionId}`,
  };
}

// --- File discovery ---

/**
 * Find all Claude Code project directories.
 */
function findProjectDirs(claudeDir: string): string[] {
  const projectsDir = path.join(claudeDir, 'projects');
  if (!fs.existsSync(projectsDir)) {
    throw new Error(`Claude Code projects directory not found: ${projectsDir}`);
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(projectsDir, e.name));
}

/**
 * Find all JSONL conversation files in a project directory.
 */
function findConversationFiles(projectDir: string): string[] {
  const entries = fs.readdirSync(projectDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => path.join(projectDir, e.name));
}

// --- Batch import ---

/**
 * Import all Claude Code conversations into Atlas.
 */
export async function importConversations(
  claudeDir: string,
  atlasUrl: string,
): Promise<ImportSummary> {
  const start = Date.now();
  const summary: ImportSummary = {
    conversationsScanned: 0,
    eventsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  const resolvedDir = path.resolve(claudeDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Claude Code directory does not exist: ${resolvedDir}`);
  }

  const projectDirs = findProjectDirs(resolvedDir);
  console.log(`Found ${projectDirs.length} project directories`);

  const eventsUrl = `${atlasUrl.replace(/\/$/, '')}/events`;

  for (const projectDir of projectDirs) {
    const files = findConversationFiles(projectDir);

    for (const filePath of files) {
      summary.conversationsScanned++;
      const relativePath = path.relative(resolvedDir, filePath);

      try {
        const conversation = parseConversation(filePath, projectDir);

        // Skip empty conversations (no user/assistant messages)
        if (conversation.turns.length === 0) {
          continue;
        }

        const event = conversationToEvent(conversation);

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

        if (summary.eventsCreated % 50 === 0) {
          console.log(`  Progress: ${summary.eventsCreated} events created`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ file: relativePath, error: message });
        console.error(`  Error processing ${relativePath}: ${message}`);
      }
    }
  }

  summary.durationMs = Date.now() - start;
  return summary;
}
