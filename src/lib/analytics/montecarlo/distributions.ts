import type { Random } from "./random";

/**
 * One standard normal per call (Box-Muller). The sine twin is discarded on purpose: caching it would make the number
 * of uniforms consumed depend on the parity of earlier draws, which breaks reproducibility.
 */
export function nextStandardNormal(random: Random) {
  const u1 = 1 - random.nextUniform();
  const u2 = random.nextUniform();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Gamma(shape, 1) by Marsaglia-Tsang with the exact log acceptance test. Needs shape >= 1. */
export function nextGamma(random: Random, shape: number) {
  if (!(shape >= 1)) {
    throw new Error("The gamma sampler needs a shape of at least 1.");
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = nextStandardNormal(random);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = random.nextUniform();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

export function nextChiSquare(random: Random, degreesOfFreedom: number) {
  return 2 * nextGamma(random, degreesOfFreedom / 2);
}
