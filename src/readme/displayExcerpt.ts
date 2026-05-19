export type ReadmeDisplayExcerpt =
  | {
      kind: "missing";
      text: null;
    }
  | {
      kind: "empty-display";
      text: null;
      rawLength: number;
    }
  | {
      kind: "ready";
      text: string;
      rawLength: number;
    };

type ReadmeDisplayHealthSummary = Record<ReadmeDisplayExcerpt["kind"], number>;

type RepoWithReadmeText = {
  readmeText: string | null | undefined;
};

function normalizeReadmeForDisplay(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");

  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  text = text.replace(/<picture[\s\S]*?<\/picture>/gi, " ");
  text = text.replace(/<img\b[^>]*>/gi, " ");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  text = text.replace(/https?:\/\/img\.shields\.io\/[^\s)]+/gi, " ");
  text = text.replace(/https?:\/\/badge\.fury\.io\/[^\s)]+/gi, " ");

  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]+)`/g, "$1");

  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/[*_~]{1,3}/g, "");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");
  text = text.replace(/^\s*\|?[\s:|-]{3,}\|?[\s:|-|]*$/gm, " ");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return text.replace(/\s+/g, " ").trim();
}

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");

  if (lastSpace < Math.floor(maxLength * 0.7)) {
    return `${slice.trim()}…`;
  }

  return `${slice.slice(0, lastSpace).trim()}…`;
}

export function getReadmeDisplayExcerpt(
  readmeText: string | null | undefined,
  maxLength = 1600,
): ReadmeDisplayExcerpt {
  if (!readmeText) {
    return { kind: "missing", text: null };
  }

  const normalized = normalizeReadmeForDisplay(readmeText);
  if (!normalized) {
    return {
      kind: "empty-display",
      text: null,
      rawLength: readmeText.length,
    };
  }

  return {
    kind: "ready",
    text: truncateAtWordBoundary(normalized, maxLength),
    rawLength: readmeText.length,
  };
}

export function summarizeReadmeDisplayHealth(repos: RepoWithReadmeText[]): ReadmeDisplayHealthSummary {
  return repos.reduce<ReadmeDisplayHealthSummary>(
    (summary, repo) => {
      const excerpt = getReadmeDisplayExcerpt(repo.readmeText);
      summary[excerpt.kind] += 1;
      return summary;
    },
    {
      ready: 0,
      missing: 0,
      "empty-display": 0,
    },
  );
}
