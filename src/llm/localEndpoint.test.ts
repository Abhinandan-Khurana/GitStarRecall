import { buildLocalEndpointUrl, normalizeLocalEndpoint } from "./localEndpoint";

describe("local provider endpoint validation", () => {
  test.each([
    ["http://localhost", "http://localhost"],
    ["HTTPS://LOCALHOST:1234/", "https://localhost:1234"],
    ["http://127.0.0.1:11434", "http://127.0.0.1:11434"],
    ["https://127.42.7.255:9443/api/", "https://127.42.7.255:9443/api"],
    ["http://[::1]", "http://[::1]"],
    ["https://[::1]:1234/models/", "https://[::1]:1234/models"],
  ])("accepts loopback endpoint %s", (input, expected) => {
    expect(normalizeLocalEndpoint(input)).toBe(expected);
  });

  test.each([
    "https://example.com",
    "http://localhost.example.com:11434",
    "http://127.0.0.1.example.com",
    "http://128.0.0.1",
    "http://[::2]",
    "http://user@localhost:11434",
    "http://user:secret@127.0.0.1",
    "ftp://localhost/resource",
    "javascript:alert(1)",
    "localhost:11434",
    "http://localhost:99999",
    "http://localhost:11434?target=https://example.com",
    "http://localhost:11434/#fragment",
    "http://2130706433:11434",
    "http://0x7f000001:11434",
    "http://0177.0.0.1:11434",
    "http://127.1:11434",
    "http://127.000.0.1:11434",
    "http://127.0.00.1:11434",
    "http://[0:0:0:0:0:0:0:1]:11434",
  ])("rejects unsafe or malformed endpoint %s", (input) => {
    expect(() => normalizeLocalEndpoint(input)).toThrow(/endpoint/u);
  });

  test("preserves a safe base path while appending the request path", () => {
    expect(buildLocalEndpointUrl("http://127.12.0.8:11434/proxy/", "/api/chat", "Ollama")).toBe(
      "http://127.12.0.8:11434/proxy/api/chat",
    );
  });
});
