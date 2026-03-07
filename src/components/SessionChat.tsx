"use client";

import * as React from "react";
import type { ChatMessageRecord } from "../db/types";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";
import type { WebLLMModelProfile } from "../llm/webllm/modelCatalog";
import SafeMarkdown from "./SafeMarkdown";
import { ProviderSettingsForm } from "./ProviderSettingsForm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowUpIcon, SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
            "max-w-[85%] break-words px-4 py-2.5 text-sm transition-all [&_*]:text-inherit",
            message.role === "user"
              ? "session-chat-bubble-user ml-auto shadow-md"
              : "session-chat-bubble-assistant mr-auto shadow-sm",
          )}
        >
          {message.role === "assistant" ? (
            <SafeMarkdown
              className="break-words whitespace-pre-wrap text-xs [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:p-2 [&_pre]:bg-muted/50 [&_pre]:text-inherit [&_code]:break-words [&_code]:text-inherit"
              content={message.content}
            />
          ) : (
            <span className="break-words whitespace-pre-wrap">{message.content}</span>
          )}
        </div>
      ))}
      {isGenerating ? (
        <div className="session-chat-bubble-assistant mr-auto max-w-[85%] break-words px-4 py-2.5 text-sm shadow-sm [&_*]:text-inherit">
          {streamingContent ? (
            <SafeMarkdown
              className="break-words whitespace-pre-wrap text-xs [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:text-inherit [&_code]:break-words [&_code]:text-inherit"
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
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        className="session-chat-addon-trigger h-8 rounded-full px-2 text-xs font-medium"
      >
        {selectedProvider.label}
      </Button>

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
            <ProviderSettingsForm
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
              compact
            />
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
