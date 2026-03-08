export function normalizeGitHubToken(raw: string): string {
  return String(raw)
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(/^token\s+/i, "")
    .replaceAll(/^["']+|["']+$/g, "")
    .trim();
}
