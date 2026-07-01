import { NextRequest, NextResponse } from "next/server";
import { createDashboardSupabaseClient } from "../../lib/dashboard-data";

const maxDashboardFormBytes = 16 * 1024;
const allowedNoReplyReasons = new Set([
  "did_not_see_sms",
  "distrusts_link",
  "prefers_call",
  "could_not_reach",
]);

export async function POST(request: NextRequest) {
  let form: URLSearchParams;
  try {
    form = await readLimitedForm(request);
  } catch {
    return formTooLargeResponse();
  }

  const messageId = Number(stringField(form, "message_id"));
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return NextResponse.json(
      { error: "invalid_message_id" },
      { status: 400 },
    );
  }

  const reason = stringField(form, "reason");
  if (!reason || !allowedNoReplyReasons.has(reason)) {
    return NextResponse.json(
      { error: "invalid_no_reply_reason" },
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
    "record_no_reply_reason_tag",
    {
      p_message_id: messageId,
      p_reason: reason,
      p_actor: "staff_dashboard",
    },
  );
  if (error) {
    return NextResponse.json(
      { error: "no_reply_reason_tag_failed", detail: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ reason: data?.[0] ?? null });
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
