import { render, screen } from "@testing-library/react";
import type { LLMProviderDefinition } from "../llm/types";
import { ProviderSettingsForm } from "./ProviderSettingsForm";

const providerDefinitions: LLMProviderDefinition[] = [
  {
    id: "openai-compatible",
    label: "Remote (OpenAI-compatible)",
    kind: "remote",
    defaultBaseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o-mini",
    requiresApiKey: true,
  },
  {
    id: "lmstudio",
    label: "Local (LM Studio)",
    kind: "local",
    defaultBaseUrl: "http://localhost:1234",
    defaultModel: "local-model",
    requiresApiKey: false,
  },
];

describe("ProviderSettingsForm provider consent copy", () => {
  test("classifies OpenAI-compatible as remote and LM Studio as local", () => {
    render(
      <ProviderSettingsForm
        providerId="lmstudio"
        onProviderIdChange={vi.fn()}
        providerDefinitions={providerDefinitions}
        providerBaseUrl="http://localhost:1234"
        onProviderBaseUrlChange={vi.fn()}
        providerModel="local-model"
        onProviderModelChange={vi.fn()}
        providerApiKey=""
        onProviderApiKeyChange={vi.fn()}
        selectedProvider={providerDefinitions[1]}
        allowRemoteProvider={false}
        onAllowRemoteChange={vi.fn()}
        allowLocalProvider={true}
        onAllowLocalChange={vi.fn()}
        webllmModels={[]}
        ollamaModels={[]}
        ollamaModelsStatus="idle"
        ollamaModelsError={null}
        onRefreshOllamaModels={vi.fn()}
      />,
    );

    expect(screen.getByText("Allow OpenAI-compatible requests to remote endpoints.")).toBeVisible();
    expect(
      screen.getByText("Allow Ollama, LM Studio, and browser-local WebLLM runs."),
    ).toBeVisible();
    expect(screen.queryByText(/OpenAI-compatible and LM Studio/u)).not.toBeInTheDocument();
  });
});
