import type { GitHubStarredRepo } from "./types";

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashBytes = new Uint8Array(digest);
  return Array.from(hashBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalChecksumInput(repo: GitHubStarredRepo, readmeSha256: string): string {
  const stableTopics = [...(repo.topics ?? [])].sort();
  const parts = [
    `id:${repo.id}`,
    `full_name:${repo.full_name}`,
    `description:${repo.description ?? ""}`,
    `language:${repo.language ?? ""}`,
    `topics:${stableTopics.join(",")}`,
    `updated_at:${repo.updated_at}`,
    `readme_sha256:${readmeSha256}`,
  ];

  return parts.join("\n");
}
