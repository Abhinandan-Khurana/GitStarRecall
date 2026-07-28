import { describe, expect, test, vi } from "vitest";
import {
  applyUsagePageDeletionResult,
  deleteUsagePageLocalData,
  getUsagePageDeletionBlockReason,
  type UsagePageDeletionDependencies,
} from "./usagePageDeletion";

function createDependencies(
  events: string[],
  failures: Partial<Record<keyof UsagePageDeletionDependencies, Error>> = {},
): UsagePageDeletionDependencies {
  const operation = (name: keyof UsagePageDeletionDependencies) => async () => {
    events.push(name);
    if (failures[name]) throw failures[name];
  };

  return {
    abortGenerations: () => {
      events.push("abortGenerations");
      if (failures.abortGenerations) throw failures.abortGenerations;
    },
    awaitGenerations: operation("awaitGenerations"),
    clearRepositoryData: operation("clearRepositoryData"),
    unloadWebLLM: operation("unloadWebLLM"),
    clearModelCaches: operation("clearModelCaches"),
    clearProviderSettings: operation("clearProviderSettings"),
    clearPreferences: operation("clearPreferences"),
    clearLogs: operation("clearLogs"),
  };
}

describe("getUsagePageDeletionBlockReason", () => {
  const idle = {
    hasAuthenticatedScope: true,
    fetchingStars: false,
    rebuildingEmbeddings: false,
    searching: false,
    restoringHistory: false,
    downloadingWebLLM: false,
  };

  test.each([
    ["hasAuthenticatedScope", false, /sign in/i],
    ["fetchingStars", true, /sync/i],
    ["rebuildingEmbeddings", true, /embedding rebuild/i],
    ["searching", true, /search/i],
    ["restoringHistory", true, /history restore/i],
    ["downloadingWebLLM", true, /model download/i],
  ] as const)("blocks when %s is %s", (key, value, expected) => {
    expect(getUsagePageDeletionBlockReason({ ...idle, [key]: value })).toMatch(expected);
  });

  test("returns no blocker when destructive deletion is safe", () => {
    expect(getUsagePageDeletionBlockReason(idle)).toBeNull();
  });
});

describe("deleteUsagePageLocalData", () => {
  test("aborts and awaits generation before the canonical deletion order", async () => {
    const events: string[] = [];

    const result = await deleteUsagePageLocalData(createDependencies(events));

    expect(events).toEqual([
      "abortGenerations",
      "awaitGenerations",
      "clearRepositoryData",
      "unloadWebLLM",
      "clearModelCaches",
      "clearProviderSettings",
      "clearPreferences",
      "clearLogs",
    ]);
    expect(result).toEqual({
      success: true,
      attempted: ["repository-data", "model-caches", "provider-settings", "preferences", "logs"],
      failures: [],
    });
  });

  test("waits for active generation settlement before repository deletion", async () => {
    const events: string[] = [];
    let releaseGeneration!: () => void;
    const generationSettled = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const dependencies = createDependencies(events);
    dependencies.awaitGenerations = async () => {
      events.push("awaitGenerations:start");
      await generationSettled;
      events.push("awaitGenerations:end");
    };

    const deletion = deleteUsagePageLocalData(dependencies);
    await vi.waitFor(() => expect(events).toEqual(["abortGenerations", "awaitGenerations:start"]));
    expect(events).not.toContain("clearRepositoryData");

    releaseGeneration();
    await deletion;
    expect(events.indexOf("awaitGenerations:end")).toBeLessThan(
      events.indexOf("clearRepositoryData"),
    );
  });

  test("reports partial failures, continues, and leaves logs as the final operation", async () => {
    const events: string[] = [];
    const result = await deleteUsagePageLocalData(
      createDependencies(events, {
        clearRepositoryData: new Error("database remained"),
        clearProviderSettings: new Error("settings remained"),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.failures).toEqual([
      { category: "repository-data", message: "database remained" },
      { category: "provider-settings", message: "settings remained" },
    ]);
    expect(events.at(-1)).toBe("clearLogs");
  });
});

describe("applyUsagePageDeletionResult", () => {
  test("clears stale repository UI and logs out exactly once after full success", () => {
    const clearRepositoryUi = vi.fn();
    const logout = vi.fn();

    applyUsagePageDeletionResult(
      { success: true, attempted: [], failures: [] },
      { clearRepositoryUi, logout },
    );

    expect(clearRepositoryUi).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });

  test("keeps the user signed in on partial failure and only clears UI for deleted repository data", () => {
    const clearRepositoryUi = vi.fn();
    const logout = vi.fn();

    applyUsagePageDeletionResult(
      {
        success: false,
        attempted: [],
        failures: [{ category: "provider-settings", message: "settings remained" }],
      },
      { clearRepositoryUi, logout },
    );
    expect(clearRepositoryUi).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();

    clearRepositoryUi.mockClear();
    applyUsagePageDeletionResult(
      {
        success: false,
        attempted: [],
        failures: [{ category: "repository-data", message: "database remained" }],
      },
      { clearRepositoryUi, logout },
    );
    expect(clearRepositoryUi).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});
