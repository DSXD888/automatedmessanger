import type {
  HttpClient,
  OutboundRequest,
} from "../../supabase/functions/_shared/http.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CassetteFile {
  metadata: {
    recorded_at: string;
    source: string;
    sanitized: true;
    endpoint: string;
  };
  interactions: CassetteInteraction[];
}

export interface CassetteInteraction {
  id: string;
  request: CassetteRequest;
  response: CassetteResponse;
}

export interface CassetteRequest {
  method: string;
  url?: string;
  scheme?: string;
  host?: string;
  path?: string;
  query?: string | Record<string, string | readonly string[]>;
  bodyJson?: JsonValue;
  bodyText?: string;
}

export interface CassetteResponse {
  status: number;
  headers?: Record<string, string>;
  bodyJson?: JsonValue;
  bodyText?: string;
}

export interface CassetteMetrics {
  calls: number;
  matches: number;
  misses: number;
}

export class UnrecordedRequestError extends Error {
  constructor(readonly request: NormalizedRequest) {
    super(
      `UnrecordedRequestError: ${request.method} ${request.scheme}://${request.host}${request.path}${
        request.query ? `?${request.query}` : ""
      }`,
    );
    this.name = "UnrecordedRequestError";
  }
}

interface NormalizedRequest {
  method: string;
  scheme: string;
  host: string;
  path: string;
  query: string;
  bodyJson?: JsonValue;
  bodyText?: string;
}

export function createCassetteHttpClient(
  cassetteFiles: readonly CassetteFile[],
): { client: HttpClient; metrics: CassetteMetrics } {
  const interactions = cassetteFiles.flatMap((cassette) =>
    cassette.interactions
  );
  const metrics: CassetteMetrics = { calls: 0, matches: 0, misses: 0 };

  return {
    metrics,
    client: async (request: OutboundRequest): Promise<Response> => {
      metrics.calls += 1;
      const normalized = await normalizeRequest(request);
      const match = interactions.find((interaction) =>
        requestMatches(interaction.request, normalized)
      );

      if (!match) {
        metrics.misses += 1;
        throw new UnrecordedRequestError(normalized);
      }

      metrics.matches += 1;
      return cassetteResponse(match.response);
    },
  };
}

async function normalizeRequest(
  request: OutboundRequest,
): Promise<NormalizedRequest> {
  const url = new URL(request.url.toString());
  return {
    method: (request.method ?? "GET").toUpperCase(),
    scheme: url.protocol.replace(":", "").toLowerCase(),
    host: url.host.toLowerCase(),
    path: url.pathname,
    query: normalizeQuery(url.searchParams),
    ...(await normalizeBody(request.body)),
  };
}

function requestMatches(
  expected: CassetteRequest,
  actual: NormalizedRequest,
): boolean {
  const expectedUrl = expected.url ? new URL(expected.url) : undefined;
  const scheme = expected.scheme ??
    expectedUrl?.protocol.replace(":", "").toLowerCase();
  const host = expected.host?.toLowerCase() ?? expectedUrl?.host.toLowerCase();
  const path = expected.path ?? expectedUrl?.pathname;
  const query = expected.query === undefined && expectedUrl
    ? normalizeQuery(expectedUrl.searchParams)
    : normalizeExpectedQuery(expected.query);

  return expected.method.toUpperCase() === actual.method &&
    scheme === actual.scheme &&
    host === actual.host &&
    path === actual.path &&
    query === actual.query &&
    jsonEqual(expected.bodyJson, actual.bodyJson) &&
    (expected.bodyText === undefined || expected.bodyText === actual.bodyText);
}

async function normalizeBody(
  body: BodyInit | null | undefined,
): Promise<Pick<NormalizedRequest, "bodyJson" | "bodyText">> {
  if (body === null || body === undefined) {
    return {};
  }

  let bodyText: string;
  if (typeof body === "string") {
    bodyText = body;
  } else if (body instanceof URLSearchParams) {
    bodyText = body.toString();
  } else if (body instanceof Uint8Array) {
    bodyText = new TextDecoder().decode(body);
  } else if (body instanceof Blob) {
    bodyText = await body.text();
  } else {
    throw new TypeError("Cassette request body type is not supported");
  }

  const bodyJson = parseJsonValue(bodyText);
  return bodyJson === undefined ? { bodyText } : { bodyJson };
}

function cassetteResponse(response: CassetteResponse): Response {
  const headers = new Headers(response.headers);
  if (response.bodyJson !== undefined) {
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(response.bodyJson), {
      status: response.status,
      headers,
    });
  }

  return new Response(response.bodyText ?? "", {
    status: response.status,
    headers,
  });
}

function normalizeExpectedQuery(
  query: CassetteRequest["query"],
): string {
  if (query === undefined) {
    return "";
  }
  if (typeof query === "string") {
    return normalizeQuery(new URLSearchParams(query));
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      params.append(key, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    }
  }
  return normalizeQuery(params);
}

function normalizeQuery(params: URLSearchParams): string {
  const pairs = [...params.entries()].sort(([leftKey, leftValue], [
    rightKey,
    rightValue,
  ]) => {
    const keyComparison = leftKey.localeCompare(rightKey);
    return keyComparison === 0
      ? leftValue.localeCompare(rightValue)
      : keyComparison;
  });
  return pairs
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
}

function parseJsonValue(value: string): JsonValue | undefined {
  try {
    return normalizeJsonValue(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function jsonEqual(
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
): boolean {
  if (expected === undefined && actual === undefined) {
    return true;
  }
  return JSON.stringify(normalizeJsonValue(expected)) ===
    JSON.stringify(normalizeJsonValue(actual));
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item) ?? null);
  }
  if (typeof value === "object") {
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const record = value as Record<string, unknown>;
      normalized[key] = normalizeJsonValue(record[key]) ?? null;
    }
    return normalized;
  }
  return undefined;
}
