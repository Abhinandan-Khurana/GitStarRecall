import { useEffect, useState } from "react";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";
import type { WebLLMModelProfile } from "../llm/webllm/modelCatalog";
import { CUSTOM_MODEL_OPTION } from "../ollama/constants";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ProviderSettingsFormProps = {
  providerId: LLMProviderId;
  onProviderIdChange: (id: LLMProviderId) => void;
  providerDefinitions: LLMProviderDefinition[];
  providerBaseUrl: string;
  onProviderBaseUrlChange: (value: string) => void;
  providerModel: string;
  onProviderModelChange: (value: string) => void;
  providerApiKey: string;
  onProviderApiKeyChange: (value: string) => void;
  selectedProvider: LLMProviderDefinition;
  allowRemoteProvider: boolean;
  onAllowRemoteChange: (value: boolean) => void;
  allowLocalProvider: boolean;
  onAllowLocalChange: (value: boolean) => void;
  webllmModels: WebLLMModelProfile[];
  ollamaModels: string[];
  ollamaModelsStatus: "idle" | "loading" | "ready" | "error";
  ollamaModelsError: string | null;
  onRefreshOllamaModels: () => void;
  compact?: boolean;
};

export function ProviderSettingsForm({
  providerId,
  onProviderIdChange,
  providerDefinitions,
  providerBaseUrl,
  onProviderBaseUrlChange,
  providerModel,
  onProviderModelChange,
  providerApiKey,
  onProviderApiKeyChange,
  selectedProvider,
  allowRemoteProvider,
  onAllowRemoteChange,
  allowLocalProvider,
  onAllowLocalChange,
  webllmModels,
  ollamaModels,
  ollamaModelsStatus,
  ollamaModelsError,
  onRefreshOllamaModels,
  compact = false,
}: Readonly<ProviderSettingsFormProps>) {
  const isWebLLM = providerId === "webllm";
  const isOllama = providerId === "ollama";
  const [customOllamaModelMode, setCustomOllamaModelMode] = useState(false);

  useEffect(() => {
    if (!isOllama) {
      setCustomOllamaModelMode(false);
      return;
    }
    setCustomOllamaModelMode(!ollamaModels.includes(providerModel));
  }, [isOllama, ollamaModels, providerModel]);

  const selectedOllamaOption = customOllamaModelMode
    ? CUSTOM_MODEL_OPTION
    : ollamaModels.includes(providerModel)
      ? providerModel
      : CUSTOM_MODEL_OPTION;
  const showOllamaCustomModelInput = selectedOllamaOption === CUSTOM_MODEL_OPTION;
  const inputClassName = compact ? "h-8 text-xs" : "h-10 text-sm";
  const textClassName = compact ? "text-xs" : "text-sm";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="provider-select" className="text-muted-foreground">
            Provider
          </Label>
          <Select value={providerId} onValueChange={(value) => onProviderIdChange(value as LLMProviderId)}>
            <SelectTrigger id="provider-select" className={inputClassName}>
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {providerDefinitions.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isWebLLM ? (
          <div className="space-y-2">
            <Label htmlFor="provider-base-url" className="text-muted-foreground">
              Base URL
            </Label>
            <Input
              id="provider-base-url"
              value={providerBaseUrl}
              onChange={(event) => onProviderBaseUrlChange(event.target.value)}
              placeholder="Base URL"
              className={inputClassName}
            />
          </div>
        ) : null}
      </div>

      {isWebLLM ? (
        <div className="space-y-2">
          <Label htmlFor="provider-model-webllm" className="text-muted-foreground">
            Model
          </Label>
          <Select value={providerModel} onValueChange={onProviderModelChange}>
            <SelectTrigger id="provider-model-webllm" className={inputClassName}>
              <SelectValue placeholder="Select WebLLM model" />
            </SelectTrigger>
            <SelectContent>
              {webllmModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className={`${textClassName} text-muted-foreground`}>
            Runs in your browser. First use downloads the selected model locally after confirmation.
          </p>
        </div>
      ) : isOllama ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="provider-model-ollama" className="text-muted-foreground">
              Model
            </Label>
            <Select
              value={selectedOllamaOption}
              onValueChange={(value) => {
                if (value === CUSTOM_MODEL_OPTION) {
                  setCustomOllamaModelMode(true);
                  onProviderModelChange(providerModel.trim() || "llama3.1:8b");
                  return;
                }
                setCustomOllamaModelMode(false);
                onProviderModelChange(value);
              }}
              disabled={ollamaModelsStatus === "loading"}
            >
              <SelectTrigger id="provider-model-ollama" className={inputClassName}>
                <SelectValue placeholder="Select Ollama model" />
              </SelectTrigger>
              <SelectContent>
                {ollamaModels.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_MODEL_OPTION}>Custom model...</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showOllamaCustomModelInput ? (
            <Input
              id="provider-model-custom"
              value={providerModel}
              onChange={(event) => {
                setCustomOllamaModelMode(true);
                onProviderModelChange(event.target.value);
              }}
              placeholder="llama3.1:8b"
              className={inputClassName}
            />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background/50 p-3">
            <p className={`${textClassName} text-muted-foreground`}>
              {ollamaModels.length === 0
                ? "No chat models detected. Pull one locally and refresh."
                : "Only chat-capable models are listed here."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={compact ? "h-7 text-[11px]" : "h-8 text-xs"}
              onClick={onRefreshOllamaModels}
              disabled={ollamaModelsStatus === "loading"}
            >
              {ollamaModelsStatus === "loading" ? "Refreshing..." : "Refresh models"}
            </Button>
          </div>

          {ollamaModelsError ? (
            <Alert variant="destructive">
              <AlertDescription>{ollamaModelsError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="provider-model" className="text-muted-foreground">
            Model
          </Label>
          <Input
            id="provider-model"
            value={providerModel}
            onChange={(event) => onProviderModelChange(event.target.value)}
            placeholder="Model"
            className={inputClassName}
          />
        </div>
      )}

      {selectedProvider.requiresApiKey && !isWebLLM ? (
        <div className="space-y-2">
          <Label htmlFor="provider-api-key" className="text-muted-foreground">
            API key
          </Label>
          <Input
            id="provider-api-key"
            type="password"
            value={providerApiKey}
            onChange={(event) => onProviderApiKeyChange(event.target.value)}
            placeholder="API key"
            className={inputClassName}
          />
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 bg-background/50 px-3 py-3">
          <Checkbox
            checked={allowRemoteProvider}
            onCheckedChange={(checked) => onAllowRemoteChange(checked === true)}
          />
          <div className="min-w-0">
            <p className={`${textClassName} font-medium text-foreground`}>Remote providers</p>
            <p className="text-xs text-muted-foreground">Allow OpenAI-compatible and LM Studio requests.</p>
          </div>
        </label>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 bg-background/50 px-3 py-3">
          <Checkbox
            checked={allowLocalProvider}
            onCheckedChange={(checked) => onAllowLocalChange(checked === true)}
          />
          <div className="min-w-0">
            <p className={`${textClassName} font-medium text-foreground`}>Local providers</p>
            <p className="text-xs text-muted-foreground">Allow Ollama and browser-local WebLLM runs.</p>
          </div>
        </label>
      </div>
    </div>
  );
}
