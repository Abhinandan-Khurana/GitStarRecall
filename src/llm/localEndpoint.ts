function isExplicitIpv4Loopback(hostname: string): boolean {
  const octets = hostname.split(".");
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^\d{1,3}$/u.test(octet) || (octet.length > 1 && octet.startsWith("0")))
  ) {
    return false;
  }

  const values = octets.map(Number);
  return values[0] === 127 && values.every((value) => value >= 0 && value <= 255);
}

function isExplicitLoopbackAuthority(value: string): boolean {
  const authority = /^https?:\/\/([^/?#]+)/iu.exec(value)?.[1];
  if (!authority) {
    return false;
  }

  const bracketedIpv6 = /^\[([^\]]+)\](?::\d+)?$/u.exec(authority);
  if (bracketedIpv6) {
    return bracketedIpv6[1]?.toLowerCase() === "::1";
  }

  const host = /^(.*?)(?::\d+)?$/u.exec(authority)?.[1];
  if (!host) {
    return false;
  }
  return host.toLowerCase() === "localhost" || isExplicitIpv4Loopback(host);
}

export function normalizeLocalEndpoint(value: string, label = "Local provider"): string {
  const rawValue = value.trim();
  let endpoint: URL;
  try {
    endpoint = new URL(rawValue);
  } catch {
    throw new Error(`${label} endpoint must be a valid HTTP(S) loopback URL`);
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error(`${label} endpoint must use HTTP or HTTPS`);
  }
  if (endpoint.username || endpoint.password) {
    throw new Error(`${label} endpoint must not include credentials`);
  }
  if (!isExplicitLoopbackAuthority(rawValue)) {
    throw new Error(`${label} endpoint must use localhost, 127.0.0.0/8, or [::1]`);
  }
  if (endpoint.search || endpoint.hash) {
    throw new Error(`${label} endpoint must not include a query or fragment`);
  }

  endpoint.pathname = endpoint.pathname.replace(/\/+$/u, "");
  return endpoint.toString().replace(/\/$/u, "");
}

export function buildLocalEndpointUrl(baseUrl: string, path: `/${string}`, label: string): string {
  return `${normalizeLocalEndpoint(baseUrl, label)}${path}`;
}
