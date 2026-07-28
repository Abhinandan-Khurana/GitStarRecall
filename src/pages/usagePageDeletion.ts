import { runLocalDataDeletion, type DeleteLocalDataResult } from "../localData/deleteLocalData";

export type UsagePageDeletionBlockers = {
  hasAuthenticatedScope: boolean;
  fetchingStars: boolean;
  rebuildingEmbeddings: boolean;
  searching: boolean;
  restoringHistory: boolean;
  downloadingWebLLM: boolean;
};

export type UsagePageDeletionDependencies = {
  abortGenerations(): void;
  awaitGenerations(): Promise<void>;
  clearRepositoryData(): Promise<void>;
  unloadWebLLM(): Promise<void>;
  clearModelCaches(): Promise<void>;
  clearProviderSettings(): Promise<void>;
  clearPreferences(): Promise<void>;
  clearLogs(): Promise<void>;
};

export type UsagePageDeletionCompletion = {
  clearRepositoryUi(): void;
  logout(): void;
};

/** Waits only for the generations that were active when settlement began. */
export async function settleUsagePageGenerations(
  activeGenerations: ReadonlySet<Promise<unknown>>,
): Promise<void> {
  const generationSnapshot = [...activeGenerations];
  await Promise.allSettled(generationSnapshot);
}

/** Returns the first active operation that makes destructive deletion unsafe. */
export function getUsagePageDeletionBlockReason(
  blockers: Readonly<UsagePageDeletionBlockers>,
): string | null {
  if (!blockers.hasAuthenticatedScope) return "Sign in before deleting scoped local data.";
  if (blockers.fetchingStars) return "Wait for GitHub sync to finish.";
  if (blockers.rebuildingEmbeddings) return "Wait for the embedding rebuild to finish.";
  if (blockers.searching) return "Wait for the active search to finish.";
  if (blockers.restoringHistory) return "Wait for chat history restore to finish.";
  if (blockers.downloadingWebLLM) return "Wait for the WebLLM model download to finish.";
  return null;
}

/**
 * Cancels generation, waits for its persistence path to settle, then runs the
 * destructive categories in their canonical order. Logs are deliberately last.
 */
export async function deleteUsagePageLocalData(
  dependencies: Readonly<UsagePageDeletionDependencies>,
): Promise<DeleteLocalDataResult> {
  try {
    dependencies.abortGenerations();
  } catch {
    // Generation cancellation is best effort and must not prevent deletion.
  }
  try {
    await dependencies.awaitGenerations();
  } catch {
    // A failed generation settlement must not prevent deletion categories.
  }

  return runLocalDataDeletion([
    { category: "repository-data", run: dependencies.clearRepositoryData },
    {
      category: "model-caches",
      run: async () => {
        await dependencies.unloadWebLLM();
        await dependencies.clearModelCaches();
      },
    },
    { category: "provider-settings", run: dependencies.clearProviderSettings },
    { category: "preferences", run: dependencies.clearPreferences },
    { category: "logs", run: dependencies.clearLogs },
  ]);
}

/** Applies the two consequential UI outcomes without ever claiming partial success. */
export function applyUsagePageDeletionResult(
  result: Readonly<DeleteLocalDataResult>,
  completion: Readonly<UsagePageDeletionCompletion>,
): void {
  if (!result.failures.some((failure) => failure.category === "repository-data")) {
    completion.clearRepositoryUi();
  }
  if (result.success) {
    completion.logout();
  }
}
