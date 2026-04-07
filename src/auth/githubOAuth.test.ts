import { buildGitHubAuthorizeUrl, getOAuthConfig } from "./githubOAuth";

function createSessionStorageMock(): Storage {
  const backing = new Map<string, string>();
  return {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key: string) {
      return backing.has(key) ? backing.get(key)! : null;
    },
    key(index: number) {
      return [...backing.keys()][index] ?? null;
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    setItem(key: string, value: string) {
      backing.set(key, value);
    },
  };
}

describe("github oauth scope policy", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GITHUB_CLIENT_ID", "client-id-123");
    vi.stubEnv("VITE_GITHUB_REDIRECT_URI", "http://localhost:5173/auth/callback");
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal("sessionStorage", createSessionStorageMock());
    vi.stubGlobal("btoa", (input: string) => Buffer.from(input, "binary").toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("uses read:user as the only configured scope", () => {
    expect(getOAuthConfig().scopes).toEqual(["read:user"]);
  });

  test("buildGitHubAuthorizeUrl serializes only read:user in scope query", async () => {
    const url = await buildGitHubAuthorizeUrl();
    const parsed = new URL(url);

    expect(parsed.searchParams.get("scope")).toBe("read:user");
    expect(parsed.searchParams.get("scope")).not.toContain("repo");
  });
});
