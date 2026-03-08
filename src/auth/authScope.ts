export function hashAuthScopeToken(raw: string): string {
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildAuthStorageScope(token: string | null): string {
  if (!token) {
    return "anon";
  }
  return `token:${hashAuthScopeToken(token)}`;
}

export function buildChatScopeKey(token: string | null): string | null {
  if (!token) {
    return null;
  }
  return `chat:${hashAuthScopeToken(token)}`;
}

export function buildEmbeddingPreferenceScopeKey(token: string | null): string {
  return buildAuthStorageScope(token);
}
