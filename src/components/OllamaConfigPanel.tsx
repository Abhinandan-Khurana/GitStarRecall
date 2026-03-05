import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const CUSTOM_MODEL_OPTION = "__custom__";

interface OllamaConfigPanelProps {
  allowOllamaEmbedding: boolean;
  onAllowOllamaChange: (checked: boolean) => void;
  ollamaBaseUrl: string;
  onBaseUrlChange: (value: string) => void;
  ollamaModel: string;
  onModelChange: (value: string) => void;
  embeddingModelOptions: string[];
  embeddingModelStatus: "idle" | "loading" | "ready" | "error";
  embeddingModelError: string | null;
  onRefreshModels: () => void;
  ollamaConnectionStatus: string;
  ollamaConnectionMessage: string | null;
  onTestConnection: () => void;
}

export function OllamaConfigPanel({
  allowOllamaEmbedding,
  onAllowOllamaChange,
  ollamaBaseUrl,
  onBaseUrlChange,
  ollamaModel,
  onModelChange,
  embeddingModelOptions,
  embeddingModelStatus,
  embeddingModelError,
  onRefreshModels,
  ollamaConnectionStatus,
  ollamaConnectionMessage,
  onTestConnection,
}: OllamaConfigPanelProps) {
  const [customModelMode, setCustomModelMode] = useState(false);

  useEffect(() => {
    setCustomModelMode(!embeddingModelOptions.includes(ollamaModel));
  }, [embeddingModelOptions, ollamaModel]);

  const selectedEmbeddingOption = customModelMode
    ? CUSTOM_MODEL_OPTION
    : embeddingModelOptions.includes(ollamaModel)
      ? ollamaModel
      : CUSTOM_MODEL_OPTION;
  const showCustomModelInput = selectedEmbeddingOption === CUSTOM_MODEL_OPTION;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="h-3 w-3" />
          Embedding settings
          <span
            className={`ml-1 h-1.5 w-1.5 rounded-full ${
              ollamaConnectionStatus === "connected"
                ? "bg-primary"
                : ollamaConnectionStatus === "failed"
                  ? "bg-destructive"
                  : "bg-muted-foreground"
            }`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="animate-fade-in mt-2 space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allowOllamaEmbedding}
              onChange={(event) => onAllowOllamaChange(event.target.checked)}
              className="rounded border-border"
            />
            Use Ollama for local embeddings
          </label>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">Runtime:</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                ollamaConnectionStatus === "connected"
                  ? "bg-primary/10 text-primary"
                  : ollamaConnectionStatus === "testing"
                    ? "bg-accent/10 text-accent"
                    : ollamaConnectionStatus === "failed"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
              }`}
            >
              {ollamaConnectionStatus === "connected"
                ? "Ollama Active"
                : ollamaConnectionStatus === "testing"
                  ? "Testing..."
                  : ollamaConnectionStatus === "inactive"
                    ? "Browser Fallback"
                    : ollamaConnectionStatus === "failed"
                      ? "Failed"
                      : "Browser"}
            </span>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Requests go only to localhost. No GitHub token is sent.
          </p>

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <div className="space-y-1">
              <Label htmlFor="ollama-base-url" className="text-[11px] text-muted-foreground">
                Ollama URL
              </Label>
              <Input
                id="ollama-base-url"
                value={ollamaBaseUrl}
                onChange={(event) => onBaseUrlChange(event.target.value)}
                placeholder="http://localhost:11434"
                className="h-8 rounded-md border-border/50 bg-background/50 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ollama-model" className="text-[11px] text-muted-foreground">
                Embedding model
              </Label>
              <Select
                value={selectedEmbeddingOption}
                onValueChange={(value) => {
                  if (value === CUSTOM_MODEL_OPTION) {
                    setCustomModelMode(true);
                    onModelChange(ollamaModel.trim() || "nomic-embed-text");
                    return;
                  }
                  setCustomModelMode(false);
                  onModelChange(value);
                }}
                disabled={embeddingModelStatus === "loading"}
              >
                <SelectTrigger id="ollama-model" className="h-8 rounded-md border-border/50 bg-background/50 text-xs">
                  <SelectValue placeholder="Select embedding model" />
                </SelectTrigger>
                <SelectContent>
                  {embeddingModelOptions.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_MODEL_OPTION}>Custom model...</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onTestConnection}
                disabled={ollamaConnectionStatus === "testing"}
                className="h-8 rounded-md text-xs"
              >
                {ollamaConnectionStatus === "testing" ? "Testing..." : "Test"}
              </Button>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRefreshModels}
                disabled={embeddingModelStatus === "loading"}
                className="h-8 rounded-md text-xs"
              >
                {embeddingModelStatus === "loading" ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </div>

          {showCustomModelInput ? (
            <Input
              value={ollamaModel}
              onChange={(event) => {
                setCustomModelMode(true);
                onModelChange(event.target.value);
              }}
              placeholder="nomic-embed-text"
              className="h-8 rounded-md border-border/50 bg-background/50 text-xs"
            />
          ) : null}

          {embeddingModelOptions.length === 0 && embeddingModelStatus !== "loading" ? (
            <p className="text-[11px] text-muted-foreground">
              No embedding models detected yet. Pull one locally (for example `nomic-embed-text`) and refresh.
            </p>
          ) : null}

          {embeddingModelError ? (
            <p className="text-[11px] text-destructive">{embeddingModelError}</p>
          ) : null}

          {ollamaConnectionMessage && (
            <p
              className={`text-[11px] ${
                ollamaConnectionStatus === "failed" || ollamaConnectionStatus === "inactive"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {ollamaConnectionMessage}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
