import { z } from "zod";

export const CAPABILITY_TOKEN_BYTES = 16;
export const CAPABILITY_TOKEN_LENGTH = 22;

export type RandomBytes = (length: number) => Uint8Array;

export interface ActionNonceClaims {
  nonce: string;
  action: string;
  messageId: string;
  renderFingerprint: string;
  expiresAt: string;
}

const encoder = new TextEncoder();
const capabilityTokenPattern = /^[A-Za-z0-9_-]{22}$/u;
const actionNonceClaimsSchema = z.object({
  nonce: z.string().min(1),
  action: z.string().min(1),
  messageId: z.string().min(1),
  renderFingerprint: z.string().min(1),
  expiresAt: z.string().min(1),
});

export function cryptoRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("Random byte length must be a positive integer");
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function generateCapabilityToken(
  rng: RandomBytes = cryptoRandomBytes,
): string {
  return encodeCapabilityBytes(rng(CAPABILITY_TOKEN_BYTES));
}

export function generateActionNonce(
  rng: RandomBytes = cryptoRandomBytes,
): string {
  return encodeCapabilityBytes(rng(CAPABILITY_TOKEN_BYTES));
}

export function isCapabilityToken(value: string): boolean {
  return capabilityTokenPattern.test(value);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function digestCapabilityToken(
  token: string,
  pepper: string,
): Promise<Uint8Array> {
  assertCapabilityToken(token);
  return await hmacSha256Bytes(pepper, token);
}

export async function digestCapabilityTokenHex(
  token: string,
  pepper: string,
): Promise<string> {
  return toHex(await digestCapabilityToken(token, pepper));
}

export async function hmacSha256Bytes(
  secret: string,
  value: string,
): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return new Uint8Array(signature);
}

export async function hmacSha256Hex(
  secret: string,
  value: string,
): Promise<string> {
  return toHex(await hmacSha256Bytes(secret, value));
}

export async function signActionNonce(
  claims: ActionNonceClaims,
  pepper: string,
): Promise<string> {
  const payload = encodeActionNonceClaims(claims);
  const signature = base64UrlEncode(await hmacSha256Bytes(pepper, payload));
  return `${payload}.${signature}`;
}

export async function verifyActionNonce(
  signedNonce: string,
  pepper: string,
): Promise<ActionNonceClaims | null> {
  const [payload, signature, extra] = signedNonce.split(".");
  if (!payload || !signature || extra !== undefined) {
    return null;
  }

  const expected = base64UrlEncode(await hmacSha256Bytes(pepper, payload));
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  try {
    return parseActionNonceClaims(JSON.parse(base64UrlDecodeToString(payload)));
  } catch {
    return null;
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function toPostgresByteaHex(bytes: Uint8Array): string {
  return `\\x${toHex(bytes)}`;
}

function encodeCapabilityBytes(bytes: Uint8Array): string {
  if (bytes.byteLength !== CAPABILITY_TOKEN_BYTES) {
    throw new RangeError(
      `Capability tokens must be ${CAPABILITY_TOKEN_BYTES} bytes`,
    );
  }

  const token = base64UrlEncode(bytes);
  assertCapabilityToken(token);
  return token;
}

function assertCapabilityToken(token: string): void {
  if (!isCapabilityToken(token)) {
    throw new RangeError("Capability token must be 22-character base64url");
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.trim().length === 0) {
    throw new RangeError("HMAC secret must not be empty");
  }

  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function encodeActionNonceClaims(claims: ActionNonceClaims): string {
  return base64UrlEncode(
    encoder.encode(JSON.stringify({
      nonce: claims.nonce,
      action: claims.action,
      messageId: claims.messageId,
      renderFingerprint: claims.renderFingerprint,
      expiresAt: claims.expiresAt,
    })),
  );
}

function parseActionNonceClaims(value: unknown): ActionNonceClaims {
  return actionNonceClaimsSchema.parse(value);
}

function base64UrlDecodeToString(value: string): string {
  const padded = value.padEnd(value.length + ((4 - value.length % 4) % 4), "=")
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.byteLength ^ rightBytes.byteLength;
  const maxLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}
