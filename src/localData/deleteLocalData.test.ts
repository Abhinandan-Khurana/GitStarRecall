import {
  DELETE_LOCAL_DATA_CATEGORIES,
  runLocalDataDeletion,
  type DeleteLocalDataTask,
} from "./deleteLocalData";

describe("runLocalDataDeletion", () => {
  test("runs every task in the exact caller-defined order with logs kept last", async () => {
    const order: string[] = [];
    const tasks: DeleteLocalDataTask[] = DELETE_LOCAL_DATA_CATEGORIES.map((category) => ({
      category,
      run: async () => {
        order.push(category);
      },
    }));

    const result = await runLocalDataDeletion(tasks);

    expect(order).toEqual([...DELETE_LOCAL_DATA_CATEGORIES]);
    expect(order[order.length - 1]).toBe("logs");
    expect(result.attempted).toEqual([...DELETE_LOCAL_DATA_CATEGORIES]);
    expect(result.success).toBe(true);
  });

  test("attempts all remaining tasks after an earlier task fails", async () => {
    const order: string[] = [];
    const tasks: DeleteLocalDataTask[] = [
      {
        category: "repository-data",
        run: async () => {
          order.push("repository-data");
          throw new Error("boom");
        },
      },
      {
        category: "model-caches",
        run: async () => {
          order.push("model-caches");
        },
      },
      {
        category: "logs",
        run: async () => {
          order.push("logs");
        },
      },
    ];

    const result = await runLocalDataDeletion(tasks);

    expect(order).toEqual(["repository-data", "model-caches", "logs"]);
    expect(result.attempted).toEqual(["repository-data", "model-caches", "logs"]);
  });

  test("collects per-category messages for partial failures", async () => {
    const tasks: DeleteLocalDataTask[] = [
      { category: "repository-data", run: async () => {} },
      {
        category: "provider-settings",
        run: async () => {
          throw new Error("cannot clear settings");
        },
      },
      {
        category: "logs",
        run: async () => {
          // Non-Error throw is normalized to a string message.
          throw "log handle busy";
        },
      },
    ];

    const result = await runLocalDataDeletion(tasks);

    expect(result.success).toBe(false);
    expect(result.failures).toEqual([
      { category: "provider-settings", message: "cannot clear settings" },
      { category: "logs", message: "log handle busy" },
    ]);
  });

  test("reports full success only when no task fails", async () => {
    const ok = await runLocalDataDeletion([
      { category: "repository-data", run: async () => {} },
      { category: "logs", run: async () => {} },
    ]);
    expect(ok.success).toBe(true);
    expect(ok.failures).toEqual([]);

    const bad = await runLocalDataDeletion([
      {
        category: "logs",
        run: async () => {
          throw new Error("x");
        },
      },
    ]);
    expect(bad.success).toBe(false);
    expect(bad.failures).toHaveLength(1);
  });
});
