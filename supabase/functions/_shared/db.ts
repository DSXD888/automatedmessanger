import type { Database } from "./database.types.ts";
import { createHttpClient, type HttpClient } from "./http.ts";

export type DentinoDatabase = Database;
export type DentinoApiFunctions = DentinoDatabase["api"]["Functions"];
export type DentinoApiRpcName = keyof DentinoApiFunctions & string;
export type DentinoApiRpcArgs<Name extends DentinoApiRpcName> =
  DentinoApiFunctions[Name]["Args"];
export type DentinoApiRpcInput<Name extends DentinoApiRpcName> =
  DentinoApiRpcArgs<Name> extends never ? Record<string, never>
    : DentinoApiRpcArgs<Name>;
export type DentinoApiRpcReturns<Name extends DentinoApiRpcName> =
  DentinoApiFunctions[Name]["Returns"];

export type DentinoDbRole =
  | "dentino_confirm_api"
  | "dentino_run_api"
  | "dentino_maintenance_runner";

export interface DentinoDbClientOptions {
  supabaseUrl: string;
  apiKey: string;
  role: DentinoDbRole;
  httpClient?: HttpClient;
}

export interface DentinoDbRpcClient {
  rpc<Name extends DentinoApiRpcName>(
    name: Name,
    args: DentinoApiRpcInput<Name>,
  ): Promise<DentinoApiRpcReturns<Name>>;
}

export class DentinoDbClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DentinoDbClientError";
  }
}

export function createDentinoDbRpcClient(
  options: DentinoDbClientOptions,
): DentinoDbRpcClient {
  const supabaseUrl = normalizeSupabaseUrl(options.supabaseUrl);
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new DentinoDbClientError("Supabase API key is required");
  }
  assertDbRole(options.role);

  const httpClient = options.httpClient ?? createHttpClient({
    allowedOrigins: [supabaseUrl],
  });

  return Object.freeze({
    async rpc<Name extends DentinoApiRpcName>(
      name: Name,
      args: DentinoApiRpcInput<Name>,
    ): Promise<DentinoApiRpcReturns<Name>> {
      const response = await httpClient({
        url: `${supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`,
        method: "POST",
        headers: {
          "accept": "application/json",
          "apikey": apiKey,
          "authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
          "x-dentino-db-role": options.role,
        },
        body: JSON.stringify(args),
      });

      if (!response.ok) {
        throw new DentinoDbClientError(
          `Supabase RPC ${name} failed with HTTP ${response.status}`,
          response.status,
        );
      }

      return await response.json() as DentinoApiRpcReturns<Name>;
    },
  });
}

function normalizeSupabaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    throw new DentinoDbClientError("Supabase URL is required");
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new DentinoDbClientError("Supabase URL must be http(s)");
    }
    return url.toString().replace(/\/$/u, "");
  } catch (error) {
    if (error instanceof DentinoDbClientError) {
      throw error;
    }
    throw new DentinoDbClientError("Supabase URL is invalid");
  }
}

function assertDbRole(role: DentinoDbRole): void {
  if (
    role !== "dentino_confirm_api" && role !== "dentino_run_api" &&
    role !== "dentino_maintenance_runner"
  ) {
    throw new DentinoDbClientError("Unsupported Dentino database role");
  }
}
