import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  CAPABILITY_TOKEN_LENGTH,
  digestCapabilityToken,
  digestCapabilityTokenHex,
  generateActionNonce,
  generateCapabilityToken,
  hmacSha256Hex,
  isCapabilityToken,
  signActionNonce,
  toPostgresByteaHex,
  verifyActionNonce,
} from "../../supabase/functions/_shared/tokens.ts";
import { byteRange, createSeededByteStreamRng } from "../harness/rng.ts";

const tokenPepper = ["test", "token", "pepper", "32-bytes-minimum"].join("-");
const seededCapabilityToken = ["AAECAwQF", "BgcICQoL", "DA0ODw"].join("");
const seededActionNonce = ["EBESExQV", "FhcYGRob", "HB0eHw"].join("");

Deno.test("UT-TOKEN-01 seeded RNG emits exact 128-bit capability token and nonce", () => {
  const rng = createSeededByteStreamRng([
    ...byteRange(0, 16),
    ...byteRange(16, 16),
  ]);

  const token = generateCapabilityToken(rng);
  const nonce = generateActionNonce(rng);

  assertEquals(token, seededCapabilityToken);
  assertEquals(nonce, seededActionNonce);
  assertEquals(token.length, CAPABILITY_TOKEN_LENGTH);
  assertEquals(nonce.length, CAPABILITY_TOKEN_LENGTH);
  assert(isCapabilityToken(token));
  assert(isCapabilityToken(nonce));
});

Deno.test("UT-TOKEN-01 rejects test RNG output that weakens token length", () => {
  assertThrows(
    () => generateCapabilityToken(() => Uint8Array.from(byteRange(0, 8))),
    RangeError,
    "16 bytes",
  );
});

Deno.test("UT-TOKEN-01 production path uses CSPRNG-shaped tokens", () => {
  const first = generateCapabilityToken();
  const second = generateCapabilityToken();

  assertEquals(first.length, CAPABILITY_TOKEN_LENGTH);
  assertEquals(second.length, CAPABILITY_TOKEN_LENGTH);
  assertMatch(first, /^[A-Za-z0-9_-]{22}$/u);
  assertMatch(second, /^[A-Za-z0-9_-]{22}$/u);
  assertNotEquals(first, second);
});

Deno.test("UT-TOKEN-01 stored value is HMAC digest only", async () => {
  const token = seededCapabilityToken;
  const digestBytes = await digestCapabilityToken(token, tokenPepper);
  const digestHex = await digestCapabilityTokenHex(token, tokenPepper);

  assertEquals(digestBytes.byteLength, 32);
  assertEquals(digestHex.length, 64);
  assertMatch(digestHex, /^[0-9a-f]{64}$/u);
  assertNotEquals(digestHex, token);
  assertEquals(toPostgresByteaHex(digestBytes), `\\x${digestHex}`);

  await assertRejects(
    () => digestCapabilityTokenHex("short-token", tokenPepper),
    RangeError,
    "22-character",
  );
});

Deno.test("UT-TOKEN-01 action nonce signatures are deterministic and tamper-evident", async () => {
  const claims = {
    nonce: seededActionNonce,
    action: "confirm",
    messageId: "message-1",
    renderFingerprint: await hmacSha256Hex(tokenPepper, "render"),
    expiresAt: "2026-01-15T10:10:00.000Z",
  };

  const signed = await signActionNonce(claims, tokenPepper);
  const tamperedSigned = `${signed.slice(0, -1)}${
    signed.endsWith("A") ? "B" : "A"
  }`;
  const verified = await verifyActionNonce(signed, tokenPepper);
  const tampered = await verifyActionNonce(tamperedSigned, tokenPepper);

  assertEquals(verified, claims);
  assertEquals(tampered, null);
});
