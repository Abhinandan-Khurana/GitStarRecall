import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WebLLMModelProfile } from "@/llm/webllm/modelCatalog";

type Props = {
  open: boolean;
  recommendedModelId: string;
  selectedModelId: string;
  models: WebLLMModelProfile[];
  recommendationReason: string;
  downloading: boolean;
  progress: number;
  progressText: string | null;
  onSelectModel: (modelId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export function WebLLMDownloadDialog(props: Readonly<Props>) {
  if (!props.open) {
    return null;
  }

  const recommended = props.models.find((model) => model.id === props.recommendedModelId) ?? null;
  const selected = props.models.find((model) => model.id === props.selectedModelId) ?? null;
  const progress = normalizeProgress(props.progress);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-lg border-border">
        <CardHeader className="pb-2">
          <p className="text-base font-semibold">Download local WebLLM model</p>
          <p className="text-xs text-muted-foreground">
            Model files are downloaded locally to this browser. No GitHub token is sent.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="rounded-md border border-border bg-muted/20 p-2">
            <p>
              Recommended: <span className="font-medium">{recommended?.label ?? props.recommendedModelId}</span>
            </p>
            <p className="text-muted-foreground">
              Reason: {props.recommendationReason}
              {recommended ? ` · approx ${recommended.approxDownloadMB} MB` : ""}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="webllm-model-select">Model</Label>
            <Select value={props.selectedModelId} onValueChange={props.onSelectModel}>
              <SelectTrigger id="webllm-model-select">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {props.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground">
              Selected size: {selected ? `${selected.approxDownloadMB} MB` : "unknown"}
            </p>
          </div>

          {props.downloading ? (
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {props.progressText ?? "Preparing model..."}
              </p>
              <div className="h-2 w-full rounded bg-muted">
                <div
                  className="h-2 rounded bg-accent"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="text-muted-foreground">{Math.round(progress * 100)}%</p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={props.onCancel} disabled={props.downloading}>
              Cancel
            </Button>
            <Button onClick={props.onConfirm} disabled={props.downloading}>
              Download and continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
