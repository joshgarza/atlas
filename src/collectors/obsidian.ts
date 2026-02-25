import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import chokidar from 'chokidar';
import type { CreateEventInput } from '../types.js';

// --- Types ---

export interface ParsedNote {
  title: string;
  body: string;
  tags: string[];
  links: string[];
  frontmatter: Record<string, unknown>;
  filePath: string;       // vault-relative path
  modifiedAt: string;     // ISO string
}

export interface ImportSummary {
  filesScanned: number;
  eventsCreated: number;
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
}

// --- Parsing ---

/**
 * Strip fenced code blocks and inline code spans from markdown body.
 */
function stripCodeBlocks(body: string): string {
  // Remove fenced code blocks (``` ... ```)
  let stripped = body.replace(/```[\s\S]*?```/g, '');
  // Remove inline code spans (` ... `)
  stripped = stripped.replace(/`[^`]+`/g, '');
  return stripped;
}

/**
 * Extract inline #tags from markdown body.
 * Strips code blocks first to avoid matching tags inside code.
 * Excludes heading markers (lines starting with #).
 */
function extractInlineTags(body: string): string[] {
  const stripped = stripCodeBlocks(body);
  const tags = new Set<string>();
  const tagRegex = /(?:^|[\s,;(])#([a-zA-Z][\w\-/]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(stripped)) !== null) {
    tags.add(match[1]);
  }
  return [...tags];
}

/**
 * Extract [[wikilinks]] from markdown body.
 * Handles both [[link]] and [[link|alias]] syntax.
 */
function extractWikilinks(body: string): string[] {
  const links = new Set<string>();
  const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(body)) !== null) {
    links.add(match[1].trim());
  }
  return [...links];
}

/**
 * Parse a single Obsidian markdown file into structured data.
 */
export function parseNote(absolutePath: string, vaultRoot: string): ParsedNote {
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(raw);

  // Normalize to forward slashes for consistent storage across platforms
  const relativePath = path.relative(vaultRoot, absolutePath).replace(/\\/g, '/');
  const title = path.basename(absolutePath, '.md');
  const stats = fs.statSync(absolutePath);

  // Collect tags from both frontmatter and inline
  const frontmatterTags: string[] = [];
  if (Array.isArray(frontmatter.tags)) {
    for (const t of frontmatter.tags) {
      if (typeof t === 'string') frontmatterTags.push(t);
    }
  } else if (typeof frontmatter.tags === 'string') {
    frontmatterTags.push(frontmatter.tags);
  }

  const inlineTags = extractInlineTags(body);
  const allTags = [...new Set([...frontmatterTags, ...inlineTags])];

  // Extract wikilinks from both body and frontmatter string values
  const bodyLinks = extractWikilinks(body);
  const frontmatterLinks = extractWikilinks(
    Object.values(frontmatter)
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
  );
  const allLinks = [...new Set([...bodyLinks, ...frontmatterLinks])];

  return {
    title,
    body: body.trim(),
    tags: allTags,
    links: allLinks,
    frontmatter,
    filePath: relativePath,
    modifiedAt: stats.mtime.toISOString(),
  };
}

// --- Event transformation ---

/**
 * Transform a parsed note into a CreateEventInput for the Atlas API.
 */
export function noteToEvent(note: ParsedNote): CreateEventInput {
  const content = JSON.stringify({
    title: note.title,
    body: note.body,
    tags: note.tags,
    links: note.links,
    filePath: note.filePath,
    modifiedAt: note.modifiedAt,
  });

  return {
    type: 'observation',
    source: 'obsidian',
    content,
    metadata: {
      ...note.frontmatter,
      vaultPath: note.filePath,
      modifiedAt: note.modifiedAt,
      tags: note.tags,
      links: note.links,
    },
  };
}

// --- File discovery ---

/** Directories to skip when scanning the vault. */
const SKIP_DIRS = new Set(['.obsidian', '.trash', '_templates', 'templates', '.git']);

/**
 * Recursively find all .md files in a directory, skipping excluded dirs.
 */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}

// --- Batch import ---

/**
 * Import all markdown files from an Obsidian vault into Atlas.
 */
export async function importVault(
  vaultPath: string,
  atlasUrl: string,
): Promise<ImportSummary> {
  const start = Date.now();
  const summary: ImportSummary = {
    filesScanned: 0,
    eventsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  const resolvedVault = path.resolve(vaultPath);
  if (!fs.existsSync(resolvedVault)) {
    throw new Error(`Vault path does not exist: ${resolvedVault}`);
  }

  const files = findMarkdownFiles(resolvedVault);
  summary.filesScanned = files.length;
  console.log(`Found ${files.length} markdown files in vault`);

  if (files.length === 0) {
    console.warn('Warning: no markdown files found — check vault path and contents');
  }

  const eventsUrl = `${atlasUrl.replace(/\/$/, '')}/events`;

  for (const filePath of files) {
    const relativePath = path.relative(resolvedVault, filePath);
    try {
      const note = parseNote(filePath, resolvedVault);
      const event = noteToEvent(note);

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

      // Progress log every 50 files
      if (summary.eventsCreated % 50 === 0) {
        console.log(`  Progress: ${summary.eventsCreated}/${files.length} events created`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ file: relativePath, error: message });
      console.error(`  Error processing ${relativePath}: ${message}`);
    }
  }

  summary.durationMs = Date.now() - start;
  return summary;
}

// --- File watcher ---

/** Directories to ignore in the watcher (glob patterns for chokidar). */
const WATCH_IGNORED = [
  '**/.*',           // all hidden files/dirs
  '**/node_modules',
  '**/_templates',
  '**/templates',
];

/**
 * Watch an Obsidian vault for file changes and create events in Atlas.
 *
 * Uses chokidar for reliable cross-platform recursive watching (fs.watch
 * recursive option is not supported on Linux).
 *
 * Returns an object with a close() method to stop watching.
 */
export function watchVault(
  vaultPath: string,
  atlasUrl: string,
): { close: () => Promise<void> } {
  const resolvedVault = path.resolve(vaultPath);
  const eventsUrl = `${atlasUrl.replace(/\/$/, '')}/events`;

  console.log(`Watching vault at ${resolvedVault} for changes...`);

  const watcher = chokidar.watch('**/*.md', {
    cwd: resolvedVault,
    ignored: WATCH_IGNORED,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  async function handleChange(relativePath: string): Promise<void> {
    const fullPath = path.join(resolvedVault, relativePath);

    if (!fs.existsSync(fullPath)) {
      console.log(`  File deleted: ${relativePath}`);
      return;
    }

    try {
      const note = parseNote(fullPath, resolvedVault);
      const event = noteToEvent(note);

      const response = await fetch(eventsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      console.log(`  Event created for: ${relativePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Error processing ${relativePath}: ${message}`);
    }
  }

  watcher.on('change', handleChange);
  watcher.on('add', handleChange);

  watcher.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Watcher error: ${message}`);
    watcher.close().catch(() => {});
  });

  return {
    close: () => watcher.close(),
  };
}
