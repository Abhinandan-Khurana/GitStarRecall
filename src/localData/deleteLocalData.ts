/**
 * Local-data deletion building block (PR5).
 *
 * This module owns two small, dependency-free concerns:
 *   1. the concise set of local-data categories a user can wipe, and
 *   2. an ordered task runner that attempts every category the caller hands it.
 *
 * The runner is deliberately not a global coordinator: it does not know how any
 * category is actually deleted, nor does it decide the order. Callers inject an
 * ordered list of tasks and are responsible for keeping logs last so the record
 * of the deletion survives until every other category has been attempted.
 */

/** A distinct bucket of on-device data the user can erase. */
export type DeleteLocalDataCategory =
  | "repository-data"
  | "model-caches"
  | "provider-settings"
  | "preferences"
  | "logs";

/**
 * Canonical caller-facing order. Logs are intentionally last so the deletion of
 * every other category is recorded before the log store itself is cleared.
 */
export const DELETE_LOCAL_DATA_CATEGORIES: readonly DeleteLocalDataCategory[] = [
  "repository-data",
  "model-caches",
  "provider-settings",
  "preferences",
  "logs",
];

/** A single deletion unit injected by the caller. */
export type DeleteLocalDataTask = {
  category: DeleteLocalDataCategory;
  run: () => Promise<void>;
};

/** A category whose deletion threw, with a human-readable message. */
export type DeleteLocalDataFailure = {
  category: DeleteLocalDataCategory;
  message: string;
};

/** Outcome of a full deletion pass. */
export type DeleteLocalDataResult = {
  /** True only when no task failed. */
  success: boolean;
  /** Categories attempted, in the exact order the caller provided them. */
  attempted: DeleteLocalDataCategory[];
  /** Per-category failures collected across the whole pass. */
  failures: DeleteLocalDataFailure[];
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs each task in the exact order given, attempting every one even after
 * earlier failures, and reports full success only when nothing failed.
 */
export async function runLocalDataDeletion(
  tasks: readonly DeleteLocalDataTask[],
): Promise<DeleteLocalDataResult> {
  const attempted: DeleteLocalDataCategory[] = [];
  const failures: DeleteLocalDataFailure[] = [];

  for (const task of tasks) {
    attempted.push(task.category);
    try {
      await task.run();
    } catch (error) {
      failures.push({ category: task.category, message: toMessage(error) });
    }
  }

  return { success: failures.length === 0, attempted, failures };
}
