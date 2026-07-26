import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { LLMProviderDefinition, LLMProviderId } from "../llm/types";
import {
  deriveHydratedProviderSettingsView,
  getProviderSettingsStatusMessage,
  providerSettingsStore,
  type LLMProviderSettings,
  type ProviderSettingsHydrationState,
  type ProviderSettingsSaveState,
  type ProviderSettingsStore,
} from "../lib/settings";
import { captureLocalError } from "../observability/localLog";

type ProviderSettingsPersistenceOptions = {
  scopeIdentity: string | null;
  webLLMEnabled: boolean;
  webLLMPrimaryModel: string;
  providerDefinitions: LLMProviderDefinition[];
  store?: ProviderSettingsStore;
  onPersistenceError?: (event: string, error: unknown) => void;
};

function getProviderDefinitionsKey(definitions: LLMProviderDefinition[]): string {
  return JSON.stringify(
    definitions.map(({ id, defaultBaseUrl, defaultModel }) => [id, defaultBaseUrl, defaultModel]),
  );
}

export type ProviderSettingsPersistence = {
  providerId: LLMProviderId;
  setProviderId: Dispatch<SetStateAction<LLMProviderId>>;
  providerBaseUrl: string;
  setProviderBaseUrl: Dispatch<SetStateAction<string>>;
  providerModel: string;
  setProviderModel: Dispatch<SetStateAction<string>>;
  providerApiKey: string;
  setProviderApiKey: Dispatch<SetStateAction<string>>;
  ollamaPreferredChatModel: string;
  setOllamaPreferredChatModel: Dispatch<SetStateAction<string>>;
  allowRemoteProvider: boolean;
  setAllowRemoteProvider: Dispatch<SetStateAction<boolean>>;
  allowLocalProvider: boolean;
  setAllowLocalProvider: Dispatch<SetStateAction<boolean>>;
  webllmConsent: boolean;
  setWebllmConsent: Dispatch<SetStateAction<boolean>>;
  webllmSelectedModel: string;
  setWebllmSelectedModel: Dispatch<SetStateAction<string>>;
  webllmModelManuallySet: boolean;
  setWebllmModelManuallySet: Dispatch<SetStateAction<boolean>>;
  webllmLastRecommendedModel: string;
  setWebllmLastRecommendedModel: Dispatch<SetStateAction<string>>;
  hydrationState: ProviderSettingsHydrationState;
  saveState: ProviderSettingsSaveState;
  persistenceError: string | null;
  statusMessage: string;
};

export function useProviderSettingsPersistence({
  scopeIdentity,
  webLLMEnabled,
  webLLMPrimaryModel,
  providerDefinitions,
  store = providerSettingsStore,
  onPersistenceError,
}: ProviderSettingsPersistenceOptions): ProviderSettingsPersistence {
  const reportPersistenceError = useCallback(
    (event: string, error: unknown) => {
      if (onPersistenceError) {
        onPersistenceError(event, error);
        return;
      }
      captureLocalError(scopeIdentity, event, error);
    },
    [onPersistenceError, scopeIdentity],
  );
  const providerDefinitionsKey = getProviderDefinitionsKey(providerDefinitions);
  const providerDefinitionsCacheRef = useRef({
    key: providerDefinitionsKey,
    definitions: providerDefinitions,
  });
  if (providerDefinitionsCacheRef.current.key !== providerDefinitionsKey) {
    providerDefinitionsCacheRef.current = {
      key: providerDefinitionsKey,
      definitions: providerDefinitions,
    };
  }
  const stableProviderDefinitions = providerDefinitionsCacheRef.current.definitions;
  const initial = useMemo(
    () =>
      deriveHydratedProviderSettingsView({
        saved: null,
        webLLMEnabled,
        webLLMPrimaryModel,
        providerDefinitions: stableProviderDefinitions,
      }),
    [stableProviderDefinitions, webLLMEnabled, webLLMPrimaryModel],
  );
  const [providerId, setProviderId] = useState(initial.providerId);
  const [providerBaseUrl, setProviderBaseUrl] = useState(initial.baseUrl);
  const [providerModel, setProviderModel] = useState(initial.model);
  const [providerApiKey, setProviderApiKey] = useState(initial.apiKey);
  const [ollamaPreferredChatModel, setOllamaPreferredChatModel] = useState(
    initial.ollamaPreferredModel,
  );
  const [allowRemoteProvider, setAllowRemoteProvider] = useState(initial.allowRemoteProvider);
  const [allowLocalProvider, setAllowLocalProvider] = useState(initial.allowLocalProvider);
  const [webllmConsent, setWebllmConsent] = useState(initial.webllmConsent);
  const [webllmSelectedModel, setWebllmSelectedModel] = useState(initial.webllmSelectedModel);
  const [webllmModelManuallySet, setWebllmModelManuallySet] = useState(
    initial.webllmModelManuallySet,
  );
  const [webllmLastRecommendedModel, setWebllmLastRecommendedModel] = useState(
    initial.webllmLastRecommendedModel,
  );
  const [hydrationState, setHydrationState] = useState<ProviderSettingsHydrationState>("loading");
  const [saveState, setSaveState] = useState<ProviderSettingsSaveState>("idle");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const saveRevisionRef = useRef(0);
  const hydratedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    saveRevisionRef.current += 1;
    hydratedScopeRef.current = null;
    setHydrationState("loading");
    setSaveState("idle");
    setPersistenceError(null);
    setProviderId(initial.providerId);
    setProviderBaseUrl(initial.baseUrl);
    setProviderModel(initial.model);
    setOllamaPreferredChatModel(initial.ollamaPreferredModel);
    setProviderApiKey(initial.apiKey);
    setAllowRemoteProvider(initial.allowRemoteProvider);
    setAllowLocalProvider(initial.allowLocalProvider);
    setWebllmConsent(initial.webllmConsent);
    setWebllmSelectedModel(initial.webllmSelectedModel);
    setWebllmModelManuallySet(initial.webllmModelManuallySet);
    setWebllmLastRecommendedModel(initial.webllmLastRecommendedModel);
    if (!scopeIdentity) {
      setHydrationState("ready");
      return;
    }

    let cancelled = false;
    void store
      .hydrate(scopeIdentity)
      .then((saved) => {
        if (cancelled) return;
        const hydrated = deriveHydratedProviderSettingsView({
          saved,
          webLLMEnabled,
          webLLMPrimaryModel,
          providerDefinitions: stableProviderDefinitions,
        });
        setProviderId(hydrated.providerId);
        setProviderBaseUrl(hydrated.baseUrl);
        setProviderModel(hydrated.model);
        setOllamaPreferredChatModel(hydrated.ollamaPreferredModel);
        setProviderApiKey(hydrated.apiKey);
        setAllowRemoteProvider(hydrated.allowRemoteProvider);
        setAllowLocalProvider(hydrated.allowLocalProvider);
        setWebllmConsent(hydrated.webllmConsent);
        setWebllmSelectedModel(hydrated.webllmSelectedModel);
        setWebllmModelManuallySet(hydrated.webllmModelManuallySet);
        setWebllmLastRecommendedModel(hydrated.webllmLastRecommendedModel);
        hydratedScopeRef.current = scopeIdentity;
        setHydrationState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHydrationState("error");
        setSaveState("error");
        setPersistenceError(error instanceof Error ? error.message : String(error));
        reportPersistenceError("provider_settings_hydration_failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    initial,
    reportPersistenceError,
    scopeIdentity,
    stableProviderDefinitions,
    store,
    webLLMEnabled,
    webLLMPrimaryModel,
  ]);

  useEffect(() => {
    if (!scopeIdentity || hydrationState !== "ready" || hydratedScopeRef.current !== scopeIdentity)
      return;

    const revision = saveRevisionRef.current + 1;
    saveRevisionRef.current = revision;
    const snapshot: LLMProviderSettings = {
      providerId,
      baseUrl: providerBaseUrl,
      model: providerModel,
      apiKey: providerApiKey,
      allowRemoteProvider,
      allowLocalProvider,
      webllmConsent,
      webllmPreferredModel: webllmModelManuallySet ? webllmSelectedModel : "",
      webllmLastRecommendedModel,
      ollamaPreferredModel: ollamaPreferredChatModel,
    };
    setSaveState("saving");
    setPersistenceError(null);
    void store
      .save(scopeIdentity, snapshot)
      .then(() => {
        if (saveRevisionRef.current === revision) setSaveState("saved");
      })
      .catch((error: unknown) => {
        if (saveRevisionRef.current !== revision) return;
        setSaveState("error");
        setPersistenceError(error instanceof Error ? error.message : String(error));
        reportPersistenceError("provider_settings_save_failed", error);
      });
  }, [
    allowLocalProvider,
    allowRemoteProvider,
    hydrationState,
    ollamaPreferredChatModel,
    reportPersistenceError,
    providerApiKey,
    providerBaseUrl,
    providerId,
    providerModel,
    scopeIdentity,
    store,
    webllmConsent,
    webllmLastRecommendedModel,
    webllmModelManuallySet,
    webllmSelectedModel,
  ]);

  return {
    providerId,
    setProviderId,
    providerBaseUrl,
    setProviderBaseUrl,
    providerModel,
    setProviderModel,
    providerApiKey,
    setProviderApiKey,
    ollamaPreferredChatModel,
    setOllamaPreferredChatModel,
    allowRemoteProvider,
    setAllowRemoteProvider,
    allowLocalProvider,
    setAllowLocalProvider,
    webllmConsent,
    setWebllmConsent,
    webllmSelectedModel,
    setWebllmSelectedModel,
    webllmModelManuallySet,
    setWebllmModelManuallySet,
    webllmLastRecommendedModel,
    setWebllmLastRecommendedModel,
    hydrationState,
    saveState,
    persistenceError,
    statusMessage: getProviderSettingsStatusMessage(hydrationState, saveState, persistenceError),
  };
}
