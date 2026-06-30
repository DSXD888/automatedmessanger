import type { RandomBytes } from "../../supabase/functions/_shared/tokens.ts";

export function createFixedByteRng(bytes: readonly number[]): RandomBytes {
  const fixed = Uint8Array.from(bytes);

  return (length: number): Uint8Array => {
    if (length !== fixed.byteLength) {
      throw new RangeError(
        `Fixed RNG expected ${fixed.byteLength} bytes, requested ${length}`,
      );
    }
    return new Uint8Array(fixed);
  };
}

export function createSeededByteStreamRng(
  seed: readonly number[],
): RandomBytes {
  const stream = Uint8Array.from(seed);
  let offset = 0;

  return (length: number): Uint8Array => {
    if (!Number.isInteger(length) || length <= 0) {
      throw new RangeError("RNG request length must be a positive integer");
    }
    if (offset + length > stream.byteLength) {
      throw new RangeError("Seeded RNG byte stream exhausted");
    }

    const slice = stream.slice(offset, offset + length);
    offset += length;
    return slice;
  };
}

export function byteRange(startInclusive: number, length: number): number[] {
  return Array.from({ length }, (_value, index) => startInclusive + index);
}
