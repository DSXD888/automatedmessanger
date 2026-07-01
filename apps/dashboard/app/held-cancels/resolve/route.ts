import { NextRequest, NextResponse } from "next/server";
import { createDashboardSupabaseClient } from "../../../lib/dashboard-data";
import type { Json } from "../../../../../supabase/functions/_shared/database.types";

const maxDashboardFormBytes = 16 * 1024;

export async function POST(request: NextRequest) {
  let form: URLSearchParams;
  try {
    form = await readLimitedForm(request);
  } catch {
    return formTooLargeResponse();
  }

  const targetDate = stringField(form, "target_date");
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/u.test(targetDate)) {
    return NextResponse.json(
      { error: "invalid_target_date" },
      { status: 400 },
    );
  }

  const messageIds = parseMessageIds(stringField(form, "message_ids"));
  if (!messageIds) {
    return NextResponse.json(
      { error: "invalid_message_ids" },
      { status: 400 },
    );
  }
  const resolution = stringField(form, "resolution") ??
    "staff_closed_no_write";
  if (
    resolution !== "staff_closed_no_write" &&
    resolution !== "bulk_approved_safe"
  ) {
    return NextResponse.json(
      { error: "invalid_held_cancel_resolution" },
      { status: 400 },
    );
  }

  const revalidation = parseRevalidation(stringField(form, "revalidation"));
  if (resolution === "bulk_approved_safe" && !revalidation) {
    return NextResponse.json(
      { error: "live_revalidation_required" },
      { status: 400 },
    );
  }

  const supabase = await createDashboardSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase_dashboard_unconfigured" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.schema("api").rpc(
    "resolve_held_cancels",
    {
      p_target_date: targetDate,
      p_message_ids: messageIds.length > 0 ? messageIds : undefined,
      p_resolution: resolution,
      p_actor: "staff_dashboard",
      p_revalidation: revalidation ?? {},
    },
  );
  if (error) {
    return NextResponse.json(
      { error: "held_cancel_resolution_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ resolved: data ?? [] });
}

async function readLimitedForm(request: NextRequest): Promise<URLSearchParams> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const bytes = Number(contentLength);
    if (
      !Number.isSafeInteger(bytes) || bytes < 0 ||
      bytes > maxDashboardFormBytes
    ) {
      throw new RangeError("dashboard form body is too large");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return new URLSearchParams();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = result.value ?? new Uint8Array();
    totalBytes += chunk.byteLength;
    if (totalBytes > maxDashboardFormBytes) {
      await reader.cancel();
      throw new RangeError("dashboard form body is too large");
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

const formTooLargeResponse = (): NextResponse => {
  return NextResponse.json(
    { error: "dashboard_form_too_large" },
    { status: 413 },
  );
};

const stringField = (
  form: URLSearchParams,
  name: string,
): string | undefined => {
  const value = form.get(name);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

function parseMessageIds(value: string | undefined): number[] | null {
  if (!value) {
    return [];
  }

  const parsed = value.split(",").map((entry) => Number(entry.trim()));
  if (!parsed.every((entry) => Number.isSafeInteger(entry) && entry > 0)) {
    return null;
  }
  return parsed;
}

function parseRevalidation(
  value: string | undefined,
): Json | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (isJsonObject(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function isJsonObject(value: unknown): value is { [key: string]: Json } {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is Json {
  if (
    value === null || typeof value === "string" ||
    typeof value === "number" || typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}
