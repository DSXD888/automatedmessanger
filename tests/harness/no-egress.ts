import type {
  HttpClient,
  OutboundRequest,
} from "../../supabase/functions/_shared/http.ts";

export interface StaticFetchFinding {
  path: string;
  line: number;
  column: number;
  pattern: string;
}

export interface WouldSendIntent {
  channel: "sms";
  recipientRef: string;
  messageRef: string;
}

export interface SideEffectRecorder {
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

export function createSideEffectRecorder(): SideEffectRecorder {
  const intents: WouldSendIntent[] = [];
  return {
    get wouldSendIntents(): readonly WouldSendIntent[] {
      return intents;
    },
    get providerCallCount(): number {
      return 0;
    },
    get clinicCardsWriteCount(): number {
      return 0;
    },
    recordWouldSend(intent: WouldSendIntent): void {
      intents.push(intent);
    },
  };
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
