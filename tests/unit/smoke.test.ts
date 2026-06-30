import { assertEquals, assertMatch } from "@std/assert";
import { computeFromFixedTestClock } from "../harness/clock.ts";
import {
  digestCapabilityTokenHex,
  generateCapabilityToken,
} from "../../supabase/functions/_shared/tokens.ts";
import { normalizeUkrainianMobilePhone } from "../../supabase/functions/_shared/phone.ts";
import { byteRange, createFixedByteRng } from "../harness/rng.ts";

const tokenPepper = ["test", "token", "pepper", "32-bytes-minimum"].join("-");
const seededCapabilityToken = ["AAECAwQF", "BgcICQoL", "DA0ODw"].join("");

Deno.test("Rung A smoke covers clock, token digest, and phone normalization", async () => {
  assertEquals(
    computeFromFixedTestClock("2026-06-15T09:00:00.000Z").targetDateKyiv,
    "2026-06-16",
  );
  assertEquals(
    normalizeUkrainianMobilePhone("+38 (067) 000-00-00").e164,
    "+380670000000",
  );

  const token = generateCapabilityToken(createFixedByteRng(byteRange(0, 16)));
  assertEquals(token, seededCapabilityToken);
  assertMatch(
    await digestCapabilityTokenHex(token, tokenPepper),
    /^[0-9a-f]{64}$/u,
  );
});
