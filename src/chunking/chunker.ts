import type { ChunkRecord, RepoRecord } from "../db/types";
import { chunkQualityScore } from "./quality";

const SHORT_DOC_CHUNK_SIZE = 900;
const MEDIUM_DOC_CHUNK_SIZE = 760;
const LONG_DOC_CHUNK_SIZE = 640;
const SHORT_DOC_OVERLAP = 140;
const MEDIUM_DOC_OVERLAP = 110;
const LONG_DOC_OVERLAP = 90;
const MAX_README_LENGTH = 100_000;
const LARGE_README_LENGTH = 30_000;
const MAX_CHUNKS_FOR_LARGE_README = 120;
const MIN_CHUNK_QUALITY_SCORE = 0.22;

/**
 * Strip HTML tags, collapse runs of whitespace, and remove common markdown
 * artifacts so the text is closer to plain prose for embedding.
 */
export function normalizeText(raw: string): string {
  let text = raw;

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, " ");

  // Remove HTML entities
  text = text.replace(/&[a-zA-Z0-9#]+;/g, " ");

  // Remove markdown image syntax ![alt](url)
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // Convert markdown links [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove markdown headings markers (keep the text)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Remove markdown emphasis/bold markers
  text = text.replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2");

  // Remove markdown code fences ``` ... ```
  text = text.replace(/```[\s\S]*?```/g, " ");

  // Remove inline code backticks
  text = text.replace(/`([^`]*)`/g, "$1");

  // Remove markdown horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove markdown blockquote markers
  text = text.replace(/^>\s?/gm, "");

  // Remove markdown list markers (-, *, 1.)
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // Collapse multiple whitespace/newlines into a single space
  text = text.replace(/\s+/g, " ");

  return text.trim();
}

/**
 * Build a short metadata header that gives the embedding model context about
 * the repo before the README body.
 */
function buildMetadataHeader(repo: RepoRecord): string {
  const parts: string[] = [`Repository: ${repo.fullName}`];

  if (repo.description) {
    parts.push(`Description: ${repo.description}`);
  }

  if (repo.language) {
    parts.push(`Language: ${repo.language}`);
  }

  if (repo.topics.length > 0) {
    parts.push(`Topics: ${repo.topics.join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Deterministic chunk id so we can upsert without duplicates.
 * Format: `{repoId}:{index}`
 */
function makeChunkId(repoId: number, index: number): string {
  return `${repoId}:${index}`;
}

function resolveChunkConfig(textLength: number): { size: number; overlap: number } {
  if (textLength <= 3_000) {
    return { size: SHORT_DOC_CHUNK_SIZE, overlap: SHORT_DOC_OVERLAP };
  }

  if (textLength <= 15_000) {
    return { size: MEDIUM_DOC_CHUNK_SIZE, overlap: MEDIUM_DOC_OVERLAP };
  }

  return { size: LONG_DOC_CHUNK_SIZE, overlap: LONG_DOC_OVERLAP };
}

/**
 * Split `text` into overlapping windows of `size` chars with `overlap` chars
 * shared between consecutive chunks. Always produces at least one chunk (even
 * for an empty string) so every repo has representation.
 */
function splitIntoChunks(text: string, size: number, overlap: number): string[] {
  if (size <= 0 || overlap < 0 || overlap >= size) {
    throw new Error("Invalid chunk window configuration");
  }

  if (text.length === 0) {
    return [""];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + size));
    start += size - overlap;
  }

  return chunks;
}

function splitReadmeIntoSections(readme: string): string[] {
  const normalizedLineEndings = readme.replace(/\r\n/g, "\n");
  const parts = normalizedLineEndings
    .split(/\n(?=#{1,6}\s)/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return [normalizedLineEndings];
  }
  return parts;
}

function applyChunkBudget(windows: string[], combinedLength: number): string[] {
  if (windows.length <= MAX_CHUNKS_FOR_LARGE_README || combinedLength < LARGE_README_LENGTH) {
    return windows;
  }

  const scored = windows.map((text, index) => ({
    text,
    index,
    score: chunkQualityScore(text),
  }));
  const candidates = scored
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: typeof scored = [];
  for (const item of candidates) {
    if (selected.length >= MAX_CHUNKS_FOR_LARGE_README) {
      break;
    }
    if (item.score >= MIN_CHUNK_QUALITY_SCORE) {
      selected.push(item);
    }
  }

  if (selected.length < MAX_CHUNKS_FOR_LARGE_README) {
    const fallback = scored
      .filter((item) => !selected.some((existing) => existing.index === item.index))
      .sort((a, b) => a.index - b.index);
    for (const item of fallback) {
      if (selected.length >= MAX_CHUNKS_FOR_LARGE_README) {
        break;
      }
      selected.push(item);
    }
  }

  selected.sort((a, b) => a.index - b.index);
  return selected.map((item) => item.text);
}

/**
 * Produce `ChunkRecord[]` for a single repo. Combines metadata header with
 * normalized, truncated README text and splits into overlapping windows.
 */
export function chunkRepo(repo: RepoRecord): ChunkRecord[] {
  const header = buildMetadataHeader(repo);

  let readmeBodyForBudget = "";
  if (repo.readmeText) {
    const sectioned = splitReadmeIntoSections(repo.readmeText).join("\n\n");
    readmeBodyForBudget = sectioned;
    if (readmeBodyForBudget.length > MAX_README_LENGTH) {
      readmeBodyForBudget = readmeBodyForBudget.slice(0, MAX_README_LENGTH);
    }
  }

  const combinedForBudget = readmeBodyForBudget.length > 0 ? `${header}\n\n${readmeBodyForBudget}` : header;

  const { size, overlap } = resolveChunkConfig(combinedForBudget.length);
  const windowsForBudget = splitIntoChunks(combinedForBudget, size, overlap);
  const selectedWindows = applyChunkBudget(windowsForBudget, combinedForBudget.length);
  const windows = selectedWindows.map((windowText) => {
    const normalized = normalizeText(windowText);
    if (normalized.length > 0) {
      return normalized;
    }
    return windowText.trim();
  });
  const now = Date.now();

  return windows.map((text, index) => {
    const chunkId = makeChunkId(repo.id, index);
    return {
      id: chunkId,
      repoId: repo.id,
      chunkId,
      text,
      source: repo.readmeText ? "metadata+readme" : "metadata",
      createdAt: now,
    };
  });
}

/**
 * Chunk every repo in the list and return a flat array of records ready for
 * `upsertChunks`.
 */
export function chunkRepos(repos: RepoRecord[]): ChunkRecord[] {
  return repos.flatMap((repo) => chunkRepo(repo));
}
