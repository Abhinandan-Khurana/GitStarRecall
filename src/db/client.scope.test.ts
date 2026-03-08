import { describe, expect, it } from "vitest";
import { getScopedDatabaseFileName, getScopedDatabaseStorageKey } from "./client";

describe("database scope naming", () => {
  it("uses anon names for the anonymous scope", () => {
    expect(getScopedDatabaseFileName("anon")).toBe("gitstarrecall.sqlite");
    expect(getScopedDatabaseStorageKey("anon")).toBe("gitstarrecall.sqlite.base64.anon");
  });

  it("sanitizes authenticated scope keys", () => {
    expect(getScopedDatabaseFileName("auth:abc/123")).toBe("gitstarrecall.auth:abc_123.sqlite");
    expect(getScopedDatabaseStorageKey("auth:abc/123")).toBe("gitstarrecall.sqlite.base64.auth:abc_123");
  });
});
