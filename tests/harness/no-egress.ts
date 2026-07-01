import type {
  HttpClient,
  OutboundRequest,
} from "../../supabase/functions/_shared/http.ts";
import type {
  SmsSendRecorder,
  WouldSendIntent,
} from "../../supabase/functions/_shared/smsSender.ts";

export interface StaticFetchFinding {
  path: string;
  line: number;
  column: number;
  pattern: string;
}

export interface SideEffectRecorder extends SmsSendRecorder {
  readonly wouldSendIntents: readonly WouldSendIntent[];
  readonly providerCallCount: number;
  readonly clinicCardsWriteCount: number;
  recordWouldSend(intent: WouldSendIntent): void;
}

export class NetworkEgressDeniedError extends Error {
  constructor(url: string) {
    super(`Network egress denied before connection: ${url}`);
    this.name = "NetworkEgressDeniedError";
  }
}

const scanRoots = ["supabase/functions", "tests"];
const allowedChokepoint = "supabase/functions/_shared/http.ts";
const browserRequestGlobal = ["XML", "Http", "Request"].join("");
const directOutboundPatterns: readonly { label: string; pattern: RegExp }[] = [
  { label: "fetch", pattern: /\bfetch\s*\(/gu },
  { label: "new Request", pattern: /\bnew\s+Request\s*\(/gu },
  {
    label: browserRequestGlobal,
    pattern: new RegExp(`\\b${browserRequestGlobal}\\b`, "gu"),
  },
  { label: "Deno.connect", pattern: /\bDeno\.connect(?:Tls)?\s*\(/gu },
];

export async function scanForDirectOutboundHttp(
  root = Deno.cwd(),
): Promise<StaticFetchFinding[]> {
  const findings: StaticFetchFinding[] = [];

  for (const scanRoot of scanRoots) {
    const absoluteRoot = joinPath(root, scanRoot);
    for await (const path of walkTypeScriptFiles(absoluteRoot)) {
      const relativePath = normalizePath(path.slice(root.length + 1));
      if (
        relativePath === allowedChokepoint || relativePath.endsWith(".d.ts")
      ) {
        continue;
      }

      findings.push(
        ...scanTextForDirectOutboundHttp(
          relativePath,
          await Deno.readTextFile(path),
        ),
      );
    }
  }

  return findings;
}

export function scanTextForDirectOutboundHttp(
  path: string,
  text: string,
): StaticFetchFinding[] {
  const relativePath = normalizePath(path);
  if (relativePath === allowedChokepoint || relativePath.endsWith(".d.ts")) {
    return [];
  }

  const findings: StaticFetchFinding[] = [];
  for (const { label, pattern } of directOutboundPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const position = lineColumn(text, match.index ?? 0);
      findings.push({
        path: relativePath,
        line: position.line,
        column: position.column,
        pattern: label,
      });
    }
  }
  return findings;
}

export function createDeniedNetworkHttpClient(): HttpClient {
  return (request: OutboundRequest): Promise<Response> => {
    const url = request.url.toString();
    if (isLocalUrl(url)) {
      return Promise.resolve(
        new Response("", {
          status: 599,
          statusText: "No egress harness local placeholder",
        }),
      );
    }
    return Promise.reject(new NetworkEgressDeniedError(url));
  };
}

export interface CountingNoEgressHttpClientOptions {
  clinicCardsVisit: Record<string, unknown>;
}

export function createCountingNoEgressHttpClient(
  sideEffects: SideEffectRecorder,
  options: CountingNoEgressHttpClientOptions,
): HttpClient {
  const recorder = asMutableSideEffectRecorder(sideEffects);
  return (request: OutboundRequest): Promise<Response> => {
    const url = request.url.toString();
    const method = (request.method ?? "GET").toUpperCase();
    const parsedUrl = safeUrl(url);

    if (isSmsProviderSend(parsedUrl, method)) {
      recorder.recordProviderCall();
      return Promise.reject(new NetworkEgressDeniedError(url));
    }

    if (isClinicCardsWrite(parsedUrl, method)) {
      recorder.recordClinicCardsWrite();
      return Promise.reject(new NetworkEgressDeniedError(url));
    }

    if (isClinicCardsVisitRead(parsedUrl, method)) {
      return Promise.resolve(jsonResponse({ visit: options.clinicCardsVisit }));
    }

    if (isLocalUrl(url)) {
      return Promise.resolve(
        new Response("", {
          status: 599,
          statusText: "No egress harness local placeholder",
        }),
      );
    }

    return Promise.reject(new NetworkEgressDeniedError(url));
  };
}

export function createSideEffectRecorder(): SideEffectRecorder {
  const intents: WouldSendIntent[] = [];
  let providerCallCount = 0;
  let clinicCardsWriteCount = 0;
  const recorder: MutableSideEffectRecorder = {
    get wouldSendIntents(): readonly WouldSendIntent[] {
      return intents;
    },
    get providerCallCount(): number {
      return providerCallCount;
    },
    get clinicCardsWriteCount(): number {
      return clinicCardsWriteCount;
    },
    recordWouldSend(intent: WouldSendIntent): void {
      intents.push(Object.freeze({ ...intent }));
    },
    recordProviderCall(): void {
      providerCallCount += 1;
    },
    recordClinicCardsWrite(): void {
      clinicCardsWriteCount += 1;
    },
  };
  return recorder;
}

interface MutableSideEffectRecorder extends SideEffectRecorder {
  recordProviderCall(): void;
  recordClinicCardsWrite(): void;
}

async function* walkTypeScriptFiles(root: string): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(root)) {
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = joinPath(root, entry.name);
    if (entry.isDirectory) {
      yield* walkTypeScriptFiles(path);
    } else if (entry.isFile && path.endsWith(".ts")) {
      yield path;
    }
  }
}

function lineColumn(
  text: string,
  index: number,
): { line: number; column: number } {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function isLocalUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  return host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
}

function asMutableSideEffectRecorder(
  sideEffects: SideEffectRecorder,
): MutableSideEffectRecorder {
  const candidate = sideEffects as Partial<MutableSideEffectRecorder>;
  if (
    typeof candidate.recordProviderCall !== "function" ||
    typeof candidate.recordClinicCardsWrite !== "function"
  ) {
    throw new TypeError(
      "Counting no-egress HTTP client requires createSideEffectRecorder()",
    );
  }
  return candidate as MutableSideEffectRecorder;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSmsProviderSend(url: URL | null, method: string): boolean {
  return method === "POST" && url?.pathname.endsWith("/message/send.json") ===
      true;
}

function isClinicCardsWrite(url: URL | null, method: string): boolean {
  return method === "PUT" && url?.pathname === "/visits";
}

function isClinicCardsVisitRead(url: URL | null, method: string): boolean {
  return method === "GET" && url?.pathname.startsWith("/visits/") === true;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function joinPath(left: string, right: string): string {
  return `${left.replace(/\/+$/u, "")}/${right.replace(/^\/+/u, "")}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

if (import.meta.main) {
  const findings = await scanForDirectOutboundHttp();
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `${finding.path}:${finding.line}:${finding.column} direct ${finding.pattern}`,
      );
    }
    Deno.exit(1);
  }
}
