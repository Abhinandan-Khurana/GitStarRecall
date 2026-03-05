"use client";

import * as React from "react";
import type { ChatMessageRecord } from "../db/types";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";
import type { WebLLMModelProfile } from "../llm/webllm/modelCatalog";
import SafeMarkdown from "./SafeMarkdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowUpIcon, SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const CUSTOM_MODEL_OPTION = "__custom__";

export interface SessionChatProps {
  messages: ChatMessageRecord[];
  isGenerating: boolean;
  streamingContent: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  error: string | null;
  canSend: boolean;
  noResultsHint?: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  providerId: LLMProviderId;
  providerBaseUrl: string;
  providerModel: string;
  providerApiKey: string;
  onProviderIdChange: (id: LLMProviderId) => void;
  onProviderBaseUrlChange: (value: string) => void;
  onProviderModelChange: (value: string) => void;
  onProviderApiKeyChange: (value: string) => void;
  selectedProvider: LLMProviderDefinition;
  providerDefinitions: LLMProviderDefinition[];
  allowRemoteProvider: boolean;
  allowLocalProvider: boolean;
  onAllowRemoteChange: (value: boolean) => void;
  onAllowLocalChange: (value: boolean) => void;
  webllmModels: WebLLMModelProfile[];
  ollamaModels: string[];
  ollamaModelsStatus: "idle" | "loading" | "ready" | "error";
  ollamaModelsError: string | null;
  onRefreshOllamaModels: () => void;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      <span className="session-chat-typing-dot size-1.5 rounded-full bg-current opacity-60" style={{ animationDelay: "0ms" }} />
      <span className="session-chat-typing-dot size-1.5 rounded-full bg-current opacity-60" style={{ animationDelay: "200ms" }} />
      <span className="session-chat-typing-dot size-1.5 rounded-full bg-current opacity-60" style={{ animationDelay: "400ms" }} />
    </span>
  );
}

type MessageListProps = {
  messages: ChatMessageRecord[];
  isGenerating: boolean;
  streamingContent: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
};

function MessageList({
  messages,
  isGenerating,
  streamingContent,
  messagesEndRef,
}: Readonly<MessageListProps>) {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const showEmptyState = messages.length === 0 && !isGenerating;

  React.useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isGenerating, streamingContent]);

  return (
    <div
      ref={scrollContainerRef}
      className="session-chat-messages flex min-h-[200px] max-h-[min(50vh,28rem)] flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-xl border p-4"
    >
      {showEmptyState ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Ask something about the results above.</p>
      ) : null}
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "max-w-[85%] px-4 py-2.5 text-sm transition-all [&_*]:text-inherit",
            message.role === "user"
              ? "session-chat-bubble-user ml-auto shadow-md"
              : "session-chat-bubble-assistant mr-auto shadow-sm",
          )}
        >
          {message.role === "assistant" ? (
            <SafeMarkdown
              className="whitespace-pre-wrap text-xs [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:p-2 [&_pre]:bg-muted/50 [&_pre]:text-inherit [&_code]:text-inherit"
              content={message.content}
            />
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>
      ))}
      {isGenerating ? (
        <div className="session-chat-bubble-assistant mr-auto max-w-[85%] px-4 py-2.5 text-sm shadow-sm [&_*]:text-inherit">
          {streamingContent ? (
            <SafeMarkdown
              className="whitespace-pre-wrap text-xs [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:text-inherit [&_code]:text-inherit"
              content={streamingContent}
            />
          ) : (
            <TypingDots />
          )}
        </div>
      ) : null}
      <div ref={messagesEndRef} />
    </div>
  );
}

type ModelSettingsPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
};

function ModelSettingsPopover({
  open,
  onOpenChange,
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
}: Readonly<ModelSettingsPopoverProps>) {
  const isWebLLM = providerId === "webllm";
  const isOllama = providerId === "ollama";
  const [customOllamaModelMode, setCustomOllamaModelMode] = React.useState(false);

  React.useEffect(() => {
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

  return (
    <div className="flex items-center gap-1">
      <Select value={providerId} onValueChange={(v) => onProviderIdChange(v as LLMProviderId)}>
        <SelectTrigger
          aria-label="Model"
          className="session-chat-addon-trigger h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:opacity-80 [&_svg]:text-muted-foreground"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" className="w-56">
          {providerDefinitions.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="session-chat-addon-icon size-8 shrink-0 rounded-full"
            aria-label="Model settings"
          >
            <SettingsIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="session-chat-settings-popover w-[22rem] p-3" align="start" side="top">
          <div className="space-y-3 text-xs">
            <div>
              <p className="text-base font-semibold">Model settings</p>
              <p className="mt-0.5 text-muted-foreground">Configure provider, endpoint, and model.</p>
            </div>

            <div className="space-y-2">
              {!isWebLLM ? (
                <div>
                  <Label htmlFor="chat-base-url" className="text-muted-foreground">Base URL</Label>
                  <Input
                    id="chat-base-url"
                    value={providerBaseUrl}
                    onChange={(e) => onProviderBaseUrlChange(e.target.value)}
                    placeholder="Base URL"
                    className="session-chat-settings-input mt-1 h-8 text-xs"
                  />
                </div>
              ) : null}

              {isWebLLM ? (
                <div>
                  <Label htmlFor="chat-model-webllm" className="text-muted-foreground">Model</Label>
                  <Select value={providerModel} onValueChange={onProviderModelChange}>
                    <SelectTrigger id="chat-model-webllm" className="mt-1 h-8 text-xs">
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
                </div>
              ) : isOllama ? (
                <div className="space-y-2">
                  <Label htmlFor="chat-model-ollama" className="text-muted-foreground">Model</Label>
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
                    <SelectTrigger id="chat-model-ollama" className="h-8 text-xs">
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

                  {showOllamaCustomModelInput ? (
                    <Input
                      id="chat-model"
                      value={providerModel}
                      onChange={(e) => {
                        setCustomOllamaModelMode(true);
                        onProviderModelChange(e.target.value);
                      }}
                      placeholder="llama3.1:8b"
                      className="session-chat-settings-input h-8 text-xs"
                    />
                  ) : null}

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      {ollamaModels.length === 0
                        ? "No chat models detected. Pull one locally and refresh."
                        : "Only chat-capable models are listed here."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={onRefreshOllamaModels}
                      disabled={ollamaModelsStatus === "loading"}
                    >
                      {ollamaModelsStatus === "loading" ? "Refreshing..." : "Refresh"}
                    </Button>
                  </div>

                  {ollamaModelsError ? (
                    <p className="text-[11px] text-destructive">{ollamaModelsError}</p>
                  ) : null}
                </div>
              ) : (
                <div>
                  <Label htmlFor="chat-model" className="text-muted-foreground">Model</Label>
                  <Input
                    id="chat-model"
                    value={providerModel}
                    onChange={(e) => onProviderModelChange(e.target.value)}
                    placeholder="Model"
                    className="session-chat-settings-input mt-1 h-8 text-xs"
                  />
                </div>
              )}
            </div>

            {isWebLLM ? (
              <p className="rounded border border-border/80 px-2 py-2 text-muted-foreground">
                Runs in your browser. First run downloads model assets locally after confirmation.
              </p>
            ) : null}

            {selectedProvider.requiresApiKey && !isWebLLM ? (
              <div>
                <Label htmlFor="chat-api-key" className="text-muted-foreground">API key</Label>
                <Input
                  id="chat-api-key"
                  type="password"
                  value={providerApiKey}
                  onChange={(e) => onProviderApiKeyChange(e.target.value)}
                  placeholder="API key"
                  className="session-chat-settings-input mt-1 h-8 text-xs"
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-4 rounded-md border border-border/80 px-2 py-2">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={allowRemoteProvider} onCheckedChange={(checked) => onAllowRemoteChange(Boolean(checked))} />
                <span className="text-muted-foreground">Remote</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={allowLocalProvider} onCheckedChange={(checked) => onAllowLocalChange(Boolean(checked))} />
                <span className="text-muted-foreground">Local (Ollama)</span>
              </label>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type ChatComposerProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  isGenerating: boolean;
  canSend: boolean;
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
};

function ChatComposer({
  prompt,
  onPromptChange,
  onSend,
  onCancel,
  isGenerating,
  canSend,
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
}: Readonly<ChatComposerProps>) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (prompt.trim() && !isGenerating && canSend) {
        onSend();
      }
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="session-chat-prompt-wrap rounded-2xl border shadow-sm">
        <Textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Ask a question about the results above..."
          className="session-chat-prompt-input min-h-[88px] resize-none border-0 bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          onKeyDown={handleKeyDown}
          aria-label="Chat prompt"
        />
        <div className="session-chat-addon-row flex items-center justify-between gap-2 border-t px-2 py-2">
          <ModelSettingsPopover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            providerId={providerId}
            onProviderIdChange={onProviderIdChange}
            providerDefinitions={providerDefinitions}
            providerBaseUrl={providerBaseUrl}
            onProviderBaseUrlChange={onProviderBaseUrlChange}
            providerModel={providerModel}
            onProviderModelChange={onProviderModelChange}
            providerApiKey={providerApiKey}
            onProviderApiKeyChange={onProviderApiKeyChange}
            selectedProvider={selectedProvider}
            allowRemoteProvider={allowRemoteProvider}
            onAllowRemoteChange={onAllowRemoteChange}
            allowLocalProvider={allowLocalProvider}
            onAllowLocalChange={onAllowLocalChange}
            webllmModels={webllmModels}
            ollamaModels={ollamaModels}
            ollamaModelsStatus={ollamaModelsStatus}
            ollamaModelsError={ollamaModelsError}
            onRefreshOllamaModels={onRefreshOllamaModels}
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={!isGenerating}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-8 shrink-0 rounded-full"
              disabled={!canSend || isGenerating || !prompt.trim()}
              onClick={onSend}
              aria-label="Send"
            >
              <ArrowUpIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SessionChat({
  messages,
  isGenerating,
  streamingContent,
  prompt,
  onPromptChange,
  onSend,
  onCancel,
  error,
  canSend,
  noResultsHint,
  messagesEndRef,
  providerId,
  providerBaseUrl,
  providerModel,
  providerApiKey,
  onProviderIdChange,
  onProviderBaseUrlChange,
  onProviderModelChange,
  onProviderApiKeyChange,
  selectedProvider,
  providerDefinitions,
  allowRemoteProvider,
  allowLocalProvider,
  onAllowRemoteChange,
  onAllowLocalChange,
  webllmModels,
  ollamaModels,
  ollamaModelsStatus,
  ollamaModelsError,
  onRefreshOllamaModels,
}: Readonly<SessionChatProps>) {
  return (
    <div className="session-chat-root flex min-h-0 flex-1 flex-col gap-3">
      <MessageList
        messages={messages}
        isGenerating={isGenerating}
        streamingContent={streamingContent}
        messagesEndRef={messagesEndRef}
      />

      {noResultsHint ? (
        <p className="session-chat-hint text-xs">
          No repos match filters; broaden filters or run a new search to chat.
        </p>
      ) : null}

      {allowRemoteProvider ? (
        <p className="session-chat-hint rounded-md border border-border/80 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          Data is sent to the remote provider when you send a message.
        </p>
      ) : null}

      <ChatComposer
        prompt={prompt}
        onPromptChange={onPromptChange}
        onSend={onSend}
        onCancel={onCancel}
        isGenerating={isGenerating}
        canSend={canSend}
        providerId={providerId}
        onProviderIdChange={onProviderIdChange}
        providerDefinitions={providerDefinitions}
        providerBaseUrl={providerBaseUrl}
        onProviderBaseUrlChange={onProviderBaseUrlChange}
        providerModel={providerModel}
        onProviderModelChange={onProviderModelChange}
        providerApiKey={providerApiKey}
        onProviderApiKeyChange={onProviderApiKeyChange}
        selectedProvider={selectedProvider}
        allowRemoteProvider={allowRemoteProvider}
        onAllowRemoteChange={onAllowRemoteChange}
        allowLocalProvider={allowLocalProvider}
        onAllowLocalChange={onAllowLocalChange}
        webllmModels={webllmModels}
        ollamaModels={ollamaModels}
        ollamaModelsStatus={ollamaModelsStatus}
        ollamaModelsError={ollamaModelsError}
        onRefreshOllamaModels={onRefreshOllamaModels}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
