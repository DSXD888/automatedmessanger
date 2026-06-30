import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createHttpClient,
  OutboundHttpError,
} from "../../supabase/functions/_shared/http.ts";
import {
  ConfigError,
  loadRuntimeConfig,
} from "../../supabase/functions/_shared/config.ts";

const safeConfig = loadRuntimeConfig({
  APP_ENV: "test",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
});

Deno.test("FR-L1-PLAT-03 routes outbound calls through the injected transport", async () => {
  const calls: { method?: string; url: string; header: string | null }[] = [];
  const client = createHttpClient({
    config: safeConfig,
    defaultHeaders: { "x-default": "yes" },
    transport: (request) => {
      const headers = new Headers(request.headers);
      calls.push({
        method: request.method,
        url: request.url.toString(),
        header: headers.get("x-default"),
      });
      return Promise.resolve(new Response("ok", { status: 200 }));
    },
  });

  const response = await client({
    url: "http://cassette.invalid/demo",
    method: "post",
  });

  assertEquals(await response.text(), "ok");
  assertEquals(calls, [{
    method: "POST",
    url: "http://cassette.invalid/demo",
    header: "yes",
  }]);
});

Deno.test("FR-L1-PLAT-03 runs the boot guard before constructing clients", () => {
  assertThrows(
    () =>
      createHttpClient({
        config: loadRuntimeConfig({
          APP_ENV: "test",
          CLINICCARDS_BASE_URL: "https://api.cliniccards.example",
          SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
        }),
      }),
    ConfigError,
    "CLINICCARDS_BASE_URL",
  );
});

Deno.test("FR-L1-PLAT-03 rejects unconfigured outbound origins at the chokepoint", async () => {
  const client = createHttpClient({
    config: safeConfig,
    transport: () => Promise.resolve(new Response("unreachable")),
  });

  await assertRejects(
    () => client({ url: "https://example.com/not-allowed" }),
    OutboundHttpError,
    "not configured",
  );
});
