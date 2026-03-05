function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_./:-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function countRareLikeTokens(query: string): number {
  const tokens = tokenize(query);
  return tokens.filter((token) => /\d/.test(token) || token.includes(":") || token.includes("/") || token.includes(".")).length;
}

export function lexicalOverlapScore(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const textTokenSet = new Set(tokenize(text));
  let hits = 0;
  for (const token of queryTokens) {
    if (textTokenSet.has(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}
