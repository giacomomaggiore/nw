// Seeded xoshiro128** generator. Simulations never use Math.random: a run must be reproducible from its seed.

export const RANDOM_VERSION = "xoshiro128**-v1";

export type Random = {
  nextUint32(): number;
  /** Uniform in [0, 1). */
  nextUniform(): number;
  /** Uniform integer in [0, n) without modulo bias. */
  nextInt(n: number): number;
};

const UINT32_RANGE = 2 ** 32;

function rotateLeft(value: number, shift: number) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** Expands one uint32 into the four state words with a SplitMix-style finalizer. */
function expandSeed(seed: number) {
  let value = seed;
  const state: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    value = (value + 0x9e3779b9) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
    state.push((mixed ^ (mixed >>> 16)) >>> 0);
  }
  if (state.every((word) => word === 0)) {
    throw new Error("The seed expands to an all-zero generator state.");
  }
  return state;
}

export function createRandom(seed: number): Random {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    throw new Error("The seed must be an integer from 0 to 4294967295.");
  }
  let [s0, s1, s2, s3] = expandSeed(seed);

  function nextUint32() {
    const result = Math.imul(rotateLeft(Math.imul(s1, 5), 7), 9) >>> 0;
    const shifted = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ shifted) >>> 0;
    s3 = rotateLeft(s3, 11);
    return result;
  }

  return {
    nextUint32,
    nextUniform: () => nextUint32() / UINT32_RANGE,
    nextInt(n) {
      if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
        throw new Error("nextInt needs an integer from 1 to 4294967296.");
      }
      // Redraw values above the largest multiple of n, so every residue is equally likely.
      const accepted = Math.floor(UINT32_RANGE / n) * n;
      let value = nextUint32();
      while (value >= accepted) value = nextUint32();
      return value % n;
    },
  };
}
