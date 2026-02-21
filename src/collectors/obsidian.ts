import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
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
 * Extract inline #tags from markdown body.
 * Matches #word but not inside code blocks or frontmatter.
 * Excludes heading markers (lines starting with #).
 */
function extractInlineTags(body: string): string[] {
  const tags = new Set<string>();
  // Match #tag patterns — alphanumeric, hyphens, underscores, slashes (nested tags)
  // Must be preceded by whitespace or start of line, not inside a wikilink
  const tagRegex = /(?:^|[\s,;(])#([a-zA-Z][\w\-/]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(body)) !== null) {
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

  const relativePath = path.relative(vaultRoot, absolutePath);
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
    if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue;
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

/**
 * Watch an Obsidian vault for file changes and create events in Atlas.
 *
 * Uses Node.js built-in fs.watch with recursive option.
 * Returns an AbortController that can be used to stop watching.
 */
export function watchVault(
  vaultPath: string,
  atlasUrl: string,
): AbortController {
  const resolvedVault = path.resolve(vaultPath);
  const eventsUrl = `${atlasUrl.replace(/\/$/, '')}/events`;
  const controller = new AbortController();

  // Debounce map: file path -> timeout handle
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const DEBOUNCE_MS = 500;

  console.log(`Watching vault at ${resolvedVault} for changes...`);

  const watcher = fs.watch(
    resolvedVault,
    { recursive: true, signal: controller.signal },
    (_eventType, filename) => {
      if (!filename) return;

      // Only process .md files
      if (!filename.endsWith('.md')) return;

      // Skip excluded directories
      const parts = filename.split(path.sep);
      if (parts.some((p) => SKIP_DIRS.has(p))) return;

      const fullPath = path.join(resolvedVault, filename);

      // Debounce: editors often fire multiple events per save
      const existing = pending.get(fullPath);
      if (existing) clearTimeout(existing);

      pending.set(
        fullPath,
        setTimeout(async () => {
          pending.delete(fullPath);

          // Check if file still exists (might have been deleted)
          if (!fs.existsSync(fullPath)) {
            console.log(`  File deleted: ${filename}`);
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

            console.log(`  Event created for: ${filename}`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`  Error processing ${filename}: ${message}`);
          }
        }, DEBOUNCE_MS),
      );
    },
  );

  // Handle watcher errors gracefully
  watcher.on('error', (err) => {
    console.error(`Watcher error: ${err.message}`);
  });

  return controller;
}
