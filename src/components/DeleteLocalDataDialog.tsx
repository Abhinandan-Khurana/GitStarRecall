import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeleteLocalDataCategory, DeleteLocalDataFailure } from "@/localData/deleteLocalData";

type Props = {
  /** Whether the dialog is shown. */
  open: boolean;
  /** A deletion pass is currently running. */
  pending: boolean;
  /** An external blocker prevents deletion (e.g. an active sync). */
  blocked: boolean;
  /** Accessible explanation shown when blocked. */
  blockReason?: string;
  /** Partial failures from the most recent attempt; kept visible while shown. */
  failures: readonly DeleteLocalDataFailure[];
  onCancel: () => void;
  onConfirm: () => void;
};

const CATEGORY_LABELS: Record<DeleteLocalDataCategory, string> = {
  "repository-data": "Repository index, chunks, embeddings, and chats",
  "model-caches": "Downloaded model caches",
  "provider-settings": "Provider settings (endpoints and keys)",
  preferences: "Scoped preferences",
  logs: "Local logs",
};

const CATEGORY_ORDER: readonly DeleteLocalDataCategory[] = [
  "repository-data",
  "model-caches",
  "provider-settings",
  "preferences",
  "logs",
];

export function DeleteLocalDataDialog(props: Readonly<Props>) {
  const { open, pending, blocked, blockReason, failures, onCancel, onConfirm } = props;

  const categoriesId = useId();
  const disableReasonId = useId();
  const failuresId = useId();

  // Guard so a rapid double-click confirms exactly once, even before the parent
  // flips `pending`. Reset after an attempt settles so a visible partial failure
  // can be retried without forcing the user to dismiss the evidence first.
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (!open || !pending) {
      confirmedRef.current = false;
    }
  }, [open, pending]);

  const disableReason = pending
    ? "Deletion is in progress."
    : blocked
      ? (blockReason ?? "Deletion is currently unavailable.")
      : null;
  const confirmDisabled = disableReason !== null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !pending) {
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (confirmDisabled || confirmedRef.current) {
      return;
    }
    confirmedRef.current = true;
    onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete local data</DialogTitle>
          <DialogDescription>
            This permanently erases the app&rsquo;s data stored in this browser. It cannot be
            undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p id={categoriesId} className="font-medium">
            The following local data will be deleted:
          </p>
          <ul aria-labelledby={categoriesId} className="list-disc space-y-1 pl-5">
            {CATEGORY_ORDER.map((category) => (
              <li key={category}>{CATEGORY_LABELS[category]}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">When deletion succeeds you will be signed out.</p>
        </div>

        {failures.length > 0 ? (
          <div
            role="alert"
            aria-labelledby={failuresId}
            className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <p id={failuresId} className="font-medium">
              Some data could not be deleted:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {failures.map((failure) => (
                <li key={failure.category}>
                  {CATEGORY_LABELS[failure.category]}: {failure.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {disableReason ? (
          <p id={disableReasonId} className="text-sm text-muted-foreground">
            {disableReason}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            aria-describedby={disableReason ? disableReasonId : undefined}
          >
            Delete local data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
