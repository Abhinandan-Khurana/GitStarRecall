export function isBrowserModelIdentifier(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("onnx-community/") ||
    normalized.startsWith("xenova/")
  );
}

export function inferBackendFromModel(model: string): "browser" | "ollama" {
  return isBrowserModelIdentifier(model) ? "browser" : "ollama";
}

