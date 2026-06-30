import { loadRuntimeConfig, type RuntimeConfig } from "./config.ts";

export interface OutboundRequest {
  url: string | URL;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

export type HttpTransport = (request: OutboundRequest) => Promise<Response>;
export type HttpClient = (request: OutboundRequest) => Promise<Response>;
const platformFetch: typeof fetch = globalThis.fetch.bind(globalThis);

export interface HttpClientOptions {
  config?: RuntimeConfig;
  transport?: HttpTransport;
  defaultHeaders?: HeadersInit;
  allowedOrigins?: readonly string[];
}

export class OutboundHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundHttpError";
  }
}

export function createHttpClient(
  options: HttpClientOptions = {},
): HttpClient {
  const config = options.config ?? loadRuntimeConfig();
  const transport = options.transport ?? fetchTransport;
  const defaultHeaders = new Headers(options.defaultHeaders);
  const allowedOrigins = createAllowedOrigins(config, options.allowedOrigins);

  return async (request: OutboundRequest): Promise<Response> => {
    const url = normalizeUrl(request.url);
    assertAllowedOutboundUrl(url, allowedOrigins, config);

    const headers = new Headers(defaultHeaders);
    new Headers(request.headers).forEach((value, key) => {
      headers.set(key, value);
    });

    return await transport({
      ...request,
      url,
      method: request.method?.toUpperCase() ?? "GET",
      headers,
    });
  };
}

export function assertRuntimeConfig(
  source: Record<string, string | undefined> = Deno.env.toObject(),
): RuntimeConfig {
  return loadRuntimeConfig(source);
}

async function fetchTransport(request: OutboundRequest): Promise<Response> {
  return await platformFetch(normalizeUrl(request.url), {
    method: request.method ?? "GET",
    headers: request.headers,
    body: request.body ?? undefined,
    signal: request.signal,
  });
}

function normalizeUrl(url: string | URL): string {
  return url instanceof URL ? url.toString() : url;
}

function createAllowedOrigins(
  config: RuntimeConfig,
  extraOrigins: readonly string[] = [],
): ReadonlySet<string> {
  return new Set([
    originFor(config.clinicCardsBaseUrl),
    originFor(config.smsProviderBaseUrl),
    ...extraOrigins.map(originFor),
  ]);
}

function assertAllowedOutboundUrl(
  value: string,
  allowedOrigins: ReadonlySet<string>,
  config: RuntimeConfig,
): void {
  const url = parseOutboundUrl(value);
  if (!allowedOrigins.has(url.origin)) {
    throw new OutboundHttpError(
      `Outbound origin is not configured: ${url.origin}`,
    );
  }
  if (config.appEnv === "prod" && isPrivateOrLocalHost(url.hostname)) {
    throw new OutboundHttpError(
      `Prod outbound URL must not target a private host: ${url.hostname}`,
    );
  }
}

function parseOutboundUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new OutboundHttpError(
        `Unsupported outbound protocol: ${url.protocol}`,
      );
    }
    return url;
  } catch (error) {
    if (error instanceof OutboundHttpError) {
      throw error;
    }
    throw new OutboundHttpError("Outbound URL is invalid");
  }
}

function originFor(value: string): string {
  return parseOutboundUrl(value).origin;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./u.test(host) ||
    host.startsWith("169.254.") ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd");
}
