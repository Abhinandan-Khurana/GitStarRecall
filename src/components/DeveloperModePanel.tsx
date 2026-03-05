import { useEffect, useId, useState } from "react";
import {
  ShieldAlert,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  RotateCw,
  AlertTriangle,
  Info,
  Sliders,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";

export type RetrievalTuning = {
  fetchK: number;
  topK: number;
  mmrLambda: number;
  maxChunksPerRepo: number;
  lexicalTop1Threshold: number;
  lexicalTop5MeanThreshold: number;
};

interface TuningFieldProps {
  id: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function TuningField({
  id,
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
}: TuningFieldProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (
      trimmed === "" ||
      trimmed === "-" ||
      trimmed === "." ||
      trimmed === "-."
    ) {
      setDraft(String(value));
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    onChange(parsed);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Tooltip content={description} side="right">
          <Label
            htmlFor={id}
            className="cursor-help text-[11px] font-medium text-foreground"
          >
            {label}
          </Label>
        </Tooltip>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {min} - {max}
        </span>
      </div>
      <Input
        id={id}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
        }}
        className="h-7 rounded-lg border-border/50 bg-background/50 text-xs tabular-nums transition-colors focus-visible:border-primary/50"
      />
    </div>
  );
}

interface DeveloperModePanelProps {
  isSudoUser: boolean;
  onSudoChange: (checked: boolean) => void;
  showAdvancedTuning: boolean;
  advancedTuningOpen: boolean;
  onAdvancedTuningOpenChange: (open: boolean) => void;
  retrievalTuning: RetrievalTuning;
  onUpdateRetrievalTuning: (patch: Partial<RetrievalTuning>) => void;
  onRebuildEmbeddings: () => void;
  isRebuilding: boolean;
}

export function DeveloperModePanel({
  isSudoUser,
  onSudoChange,
  showAdvancedTuning,
  advancedTuningOpen,
  onAdvancedTuningOpenChange,
  retrievalTuning,
  onUpdateRetrievalTuning,
  onRebuildEmbeddings,
  isRebuilding,
}: DeveloperModePanelProps) {
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const advancedTuningRegionId = useId();
  const fetchKWarning =
    retrievalTuning.fetchK < retrievalTuning.topK * 6;

  useEffect(() => {
    if (!isSudoUser) {
      setConfirmRebuild(false);
    }
  }, [isSudoUser]);

  return (
    <Card className="border-border/40 bg-card/70 backdrop-blur-sm">
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="sudo-toggle"
              checked={isSudoUser}
              onCheckedChange={(checked) => onSudoChange(checked === true)}
            />
            <Label
              htmlFor="sudo-toggle"
              className="cursor-pointer text-xs font-medium text-foreground"
            >
              Enable developer advanced mode
            </Label>
          </div>
          <Badge
            variant="secondary"
            className="border-0 bg-secondary/80 text-[10px] text-muted-foreground"
          >
            <ShieldAlert className="mr-1 h-3 w-3" />
            sudo
          </Badge>
        </div>
        <CardDescription className="mt-2 text-[11px] leading-relaxed">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive/80" />
            <span className="text-muted-foreground">
              Advanced tuning can improve results for your corpus, but can also
              reduce relevance, speed, or efficiency. Use only for controlled
              experiments.
            </span>
          </span>
        </CardDescription>
      </CardHeader>

      {isSudoUser && (
        <CardContent className="animate-fade-in space-y-3 px-4 pb-4 pt-0">
          <Separator className="opacity-30" />

          {/* Rebuild Embeddings */}
          <div className="flex items-center gap-2.5">
            {!confirmRebuild ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-lg border-destructive/40 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmRebuild(true)}
                disabled={isRebuilding}
              >
                <RotateCw
                  className={`h-3 w-3 ${isRebuilding ? "animate-spin" : ""}`}
                />
                {isRebuilding ? "Rebuilding..." : "Rebuild Embeddings"}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Are you sure?
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-6 rounded-lg px-2.5 text-[10px]"
                  onClick={() => {
                    setConfirmRebuild(false);
                    onRebuildEmbeddings();
                  }}
                  disabled={isRebuilding}
                >
                  Confirm Rebuild
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-lg px-2.5 text-[10px] text-muted-foreground"
                  onClick={() => setConfirmRebuild(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
            {!confirmRebuild && (
              <p className="text-[10px] text-muted-foreground">
                Re-runs embedding generation with current settings
              </p>
            )}
          </div>

          {/* Advanced Retrieval Tuning */}
          {showAdvancedTuning && (
            <div className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-border/30 bg-background/20 px-3 py-2 text-left transition-colors hover:bg-background/40"
                aria-expanded={advancedTuningOpen}
                aria-controls={advancedTuningRegionId}
                onClick={() =>
                  onAdvancedTuningOpenChange(!advancedTuningOpen)
                }
              >
                <div className="flex items-center gap-2">
                  <Sliders className="h-3.5 w-3.5 text-accent" />
                  <span className="text-[11px] font-medium text-foreground">
                    Retrieval Tuning Parameters
                  </span>
                  <Badge
                    variant="secondary"
                    className="border-0 bg-accent/10 text-[10px] text-accent"
                  >
                    <FlaskConical className="mr-1 h-2.5 w-2.5" />
                    Experimental
                  </Badge>
                </div>
                {advancedTuningOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>

              {advancedTuningOpen && (
                <div
                  id={advancedTuningRegionId}
                  className="animate-fade-in space-y-3 rounded-lg border border-border/30 bg-background/10 p-3"
                >
                  <div className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3 w-3 shrink-0 text-accent/70" />
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      Tune retrieval parameters for your corpus size. These
                      settings affect how vector search results are ranked and
                      filtered.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <TuningField
                      id="tuning-fetchK"
                      label="fetchK"
                      description="Number of candidate vectors to fetch before MMR re-ranking. Higher values improve diversity but increase latency."
                      value={retrievalTuning.fetchK}
                      min={80}
                      max={300}
                      onChange={(v) => onUpdateRetrievalTuning({ fetchK: v })}
                    />
                    <TuningField
                      id="tuning-topK"
                      label="topK"
                      description="Final number of results returned after MMR re-ranking. Lower values focus on the most relevant results."
                      value={retrievalTuning.topK}
                      min={10}
                      max={40}
                      onChange={(v) => onUpdateRetrievalTuning({ topK: v })}
                    />
                    <TuningField
                      id="tuning-mmrLambda"
                      label="MMR Lambda"
                      description="Balance between relevance (1.0) and diversity (0.0). Higher values prioritize relevance, lower values increase diversity."
                      value={retrievalTuning.mmrLambda}
                      min={0.55}
                      max={0.9}
                      step={0.01}
                      onChange={(v) =>
                        onUpdateRetrievalTuning({ mmrLambda: v })
                      }
                    />
                    <TuningField
                      id="tuning-maxChunksPerRepo"
                      label="Max Chunks / Repo"
                      description="Maximum number of text chunks to return per repository. Limits concentration of results from a single repo."
                      value={retrievalTuning.maxChunksPerRepo}
                      min={1}
                      max={5}
                      onChange={(v) =>
                        onUpdateRetrievalTuning({ maxChunksPerRepo: v })
                      }
                    />
                    <TuningField
                      id="tuning-lexicalTop1Threshold"
                      label="Lexical Top-1 Threshold"
                      description="If the top dense hit score drops below this threshold, lexical retrieval safety-net can be triggered."
                      value={retrievalTuning.lexicalTop1Threshold}
                      min={0.05}
                      max={0.5}
                      step={0.01}
                      onChange={(v) =>
                        onUpdateRetrievalTuning({
                          lexicalTop1Threshold: v,
                        })
                      }
                    />
                    <TuningField
                      id="tuning-lexicalTop5MeanThreshold"
                      label="Lexical Top-5 Mean Threshold"
                      description="If average score of top-5 dense hits falls below this threshold, lexical retrieval safety-net can be triggered."
                      value={retrievalTuning.lexicalTop5MeanThreshold}
                      min={0.05}
                      max={0.5}
                      step={0.01}
                      onChange={(v) =>
                        onUpdateRetrievalTuning({
                          lexicalTop5MeanThreshold: v,
                        })
                      }
                    />
                  </div>

                  {fetchKWarning && (
                    <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                      <p className="text-[11px] text-amber-500">
                        fetchK is low relative to topK. Increase fetchK to at
                        least 6x topK to preserve MMR diversity.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
