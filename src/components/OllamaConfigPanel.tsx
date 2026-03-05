import { useEffect, useState } from "react";
import {
  Settings2,
  Shield,
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
  Monitor,
  Cpu,
  ChevronDown,
  ChevronUp,
  Server,
  Terminal,
  Plug,
} from "lucide-react";
import { CUSTOM_MODEL_OPTION } from "../ollama/constants";
import type { BrowserEmbeddingRecommendation } from "../embeddings/browserCapability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Tooltip } from "@/components/ui/tooltip";
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
  customModelWarning: string | null;
  browserEmbeddingRecommendation: BrowserEmbeddingRecommendation | null;
  onRefreshModels: () => void;
  ollamaConnectionStatus: string;
  ollamaConnectionMessage: string | null;
  onTestConnection: () => void;
}

function ConnectionStatusIndicator({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <Badge className="border-0 bg-primary/15 text-primary">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Connected
      </Badge>
    );
  }
  if (status === "testing") {
    return (
      <Badge variant="secondary" className="border-0 bg-accent/15 text-accent">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Testing...
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="border-0 bg-destructive/15 text-destructive">
        <XCircle className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  if (status === "inactive") {
    return (
      <Badge variant="secondary" className="border-0">
        <WifiOff className="mr-1 h-3 w-3" />
        Browser Fallback
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="border-0">
      <Wifi className="mr-1 h-3 w-3" />
      Browser
    </Badge>
  );
}

function SetupGuide({ ollamaBaseUrl }: { ollamaBaseUrl: string }) {
  const steps = [
    {
      number: 1,
      title: "Install Ollama",
      description: "Download and install from ollama.com",
      icon: Terminal,
    },
    {
      number: 2,
      title: "Pull an embedding model",
      description: "Run: ollama pull qwen3-embedding:0.6b",
      icon: Server,
      code: "ollama pull qwen3-embedding:0.6b",
    },
    {
      number: 3,
      title: "Verify connection",
      description: `Ensure Ollama is running at ${ollamaBaseUrl || "http://localhost:11434"}`,
      icon: Plug,
    },
  ];

  return (
    <div className="animate-fade-in space-y-2 rounded-lg border border-border/40 bg-secondary/10 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">
        Quick Setup Guide
      </p>
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.number}
            className="flex items-start gap-2.5"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
              {step.number}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-foreground">
                {step.title}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {step.description}
              </p>
              {step.code ? (
                <code className="mt-0.5 inline-block rounded bg-background/60 px-1.5 py-0.5 text-[10px] text-accent">
                  {step.code}
                </code>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrowserCapabilityCard({
  recommendation,
}: {
  recommendation: BrowserEmbeddingRecommendation | null;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!recommendation) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-background/20 px-3 py-2">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">
          Detecting browser capabilities...
        </p>
      </div>
    );
  }

  const capability = recommendation.capability;
  const reasonLabel =
    recommendation.reason === "mobile"
      ? "Mobile device"
      : recommendation.reason === "no-webgpu"
        ? "No WebGPU"
        : recommendation.reason === "strong-desktop"
          ? "Strong desktop"
          : recommendation.reason === "weak-desktop"
            ? "Weak desktop"
            : recommendation.reason === "probe-failed"
              ? "Probe failed"
              : "Pending";

  const isStrong = recommendation.reason === "strong-desktop";

  return (
    <div className="rounded-lg border border-border/30 bg-background/20">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground">
            Browser Capability
          </span>
          <Badge
            variant="secondary"
            className={`border-0 text-[10px] ${
              isStrong
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {reasonLabel}
            {recommendation.score != null && recommendation.threshold != null
              ? ` (${recommendation.score}/${recommendation.threshold})`
              : ""}
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="animate-fade-in border-t border-border/20 px-3 pb-2.5 pt-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span>
              Model:{" "}
              <span className="font-medium text-foreground">
                {recommendation.modelId}
              </span>
            </span>
          </div>
          {capability ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span>
                Mobile: {capability.isMobile ? "yes" : "no"}
              </span>
              <span>
                WebGPU: {capability.hasWebGPU ? "yes" : "no"}
              </span>
              <span>
                Cores: {capability.hardwareConcurrency}
              </span>
              {capability.deviceMemoryGB != null && (
                <span>RAM: {capability.deviceMemoryGB}GB</span>
              )}
              {capability.perfScore != null && (
                <span>Perf: {capability.perfScore.toFixed(0)}</span>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
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
  customModelWarning,
  browserEmbeddingRecommendation,
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

  const isConnected = ollamaConnectionStatus === "connected";
  const showGuide = allowOllamaEmbedding && !isConnected && ollamaConnectionStatus !== "testing";

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
        <div className="animate-fade-in mt-2 space-y-3 rounded-xl border border-border/50 bg-card/70 p-4 backdrop-blur-sm">
          {/* Header: Ollama Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Checkbox
                id="ollama-toggle"
                checked={allowOllamaEmbedding}
                onCheckedChange={(checked) =>
                  onAllowOllamaChange(checked === true)
                }
              />
              <Label
                htmlFor="ollama-toggle"
                className="cursor-pointer text-xs font-medium text-foreground"
              >
                Use Ollama for local embeddings
              </Label>
            </div>
            <ConnectionStatusIndicator status={ollamaConnectionStatus} />
          </div>

          {/* Privacy notice */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Shield className="h-3 w-3 shrink-0 text-primary/70" />
            <span>Requests go only to localhost. No GitHub token is sent.</span>
          </div>

          <Separator className="opacity-30" />

          {/* Browser Capability (always visible) */}
          <BrowserCapabilityCard
            recommendation={browserEmbeddingRecommendation}
          />

          {/* Guided Setup (shown when ollama enabled but not connected) */}
          {showGuide && (
            <SetupGuide ollamaBaseUrl={ollamaBaseUrl} />
          )}

          {/* Connection Configuration */}
          <div className="space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="ollama-base-url"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Ollama URL
                </Label>
                <Input
                  id="ollama-base-url"
                  value={ollamaBaseUrl}
                  onChange={(event) => onBaseUrlChange(event.target.value)}
                  placeholder="http://localhost:11434"
                  className="h-8 rounded-lg border-border/50 bg-background/50 text-xs transition-colors focus-visible:border-primary/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="ollama-model"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Embedding model
                </Label>
                <Select
                  value={selectedEmbeddingOption}
                  onValueChange={(value) => {
                    if (value === CUSTOM_MODEL_OPTION) {
                      setCustomModelMode(true);
                      onModelChange(
                        ollamaModel.trim() || "qwen3-embedding:0.6b"
                      );
                      return;
                    }
                    setCustomModelMode(false);
                    onModelChange(value);
                  }}
                  disabled={embeddingModelStatus === "loading"}
                >
                  <SelectTrigger
                    id="ollama-model"
                    className="h-8 rounded-lg border-border/50 bg-background/50 text-xs transition-colors focus:border-primary/50"
                  >
                    <SelectValue placeholder="Select embedding model" />
                  </SelectTrigger>
                  <SelectContent>
                    {embeddingModelOptions.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_MODEL_OPTION}>
                      Custom model...
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {showCustomModelInput ? (
              <Input
                value={ollamaModel}
                onChange={(event) => {
                  setCustomModelMode(true);
                  onModelChange(event.target.value);
                }}
                placeholder="qwen3-embedding:0.6b"
                className="h-8 rounded-lg border-border/50 bg-background/50 text-xs"
              />
            ) : null}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <Tooltip content="Test the connection to your Ollama instance">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onTestConnection}
                  disabled={ollamaConnectionStatus === "testing"}
                  className="h-7 gap-1.5 rounded-lg text-[11px]"
                >
                  {ollamaConnectionStatus === "testing" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Cpu className="h-3 w-3" />
                  )}
                  {ollamaConnectionStatus === "testing"
                    ? "Testing..."
                    : "Test Connection"}
                </Button>
              </Tooltip>
              <Tooltip content="Refresh the list of available models from Ollama">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRefreshModels}
                  disabled={embeddingModelStatus === "loading"}
                  className="h-7 gap-1.5 rounded-lg text-[11px]"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${
                      embeddingModelStatus === "loading" ? "animate-spin" : ""
                    }`}
                  />
                  {embeddingModelStatus === "loading"
                    ? "Refreshing..."
                    : "Refresh Models"}
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Status Messages */}
          {embeddingModelOptions.length === 0 &&
            embeddingModelStatus !== "loading" && (
              <div className="flex items-start gap-2 rounded-lg border border-border/30 bg-background/20 px-3 py-2">
                <Zap className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                <p className="text-[11px] text-muted-foreground">
                  No embedding models detected. Pull one locally (e.g.{" "}
                  <code className="rounded bg-background/60 px-1 text-accent">
                    qwen3-embedding:0.6b
                  </code>
                  ) and refresh.
                </p>
              </div>
            )}

          {embeddingModelError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
              <p className="text-[11px] text-destructive">
                {embeddingModelError}
              </p>
            </div>
          ) : null}

          {customModelWarning ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <Zap className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              <p className="text-[11px] text-amber-500">
                {customModelWarning}
              </p>
            </div>
          ) : null}

          {ollamaConnectionMessage && (
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2 ${
                ollamaConnectionStatus === "connected"
                  ? "border border-primary/30 bg-primary/5"
                  : ollamaConnectionStatus === "failed" ||
                      ollamaConnectionStatus === "inactive"
                    ? "border border-destructive/30 bg-destructive/5"
                    : "border border-border/30 bg-background/20"
              }`}
            >
              {ollamaConnectionStatus === "connected" ? (
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              ) : ollamaConnectionStatus === "failed" ||
                ollamaConnectionStatus === "inactive" ? (
                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
              ) : (
                <Wifi className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <p
                className={`text-[11px] ${
                  ollamaConnectionStatus === "connected"
                    ? "text-primary"
                    : ollamaConnectionStatus === "failed" ||
                        ollamaConnectionStatus === "inactive"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {ollamaConnectionMessage}
              </p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
