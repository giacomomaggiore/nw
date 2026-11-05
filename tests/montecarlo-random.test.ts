import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextChiSquare, nextGamma, nextStandardNormal } from "@/lib/analytics/montecarlo/distributions";
import { createRandom } from "@/lib/analytics/montecarlo/random";

// Reference vectors from an independent Python implementation of xoshiro128** and the seed expansion.
const referenceVectors: Array<[number, number[]]> = [
  [0, [3809008728, 1133695204, 53579671, 2891528803, 139681546]],
  [42, [2837322924, 544945897, 479756282, 3500138142, 339756180]],
  [4294967295, [835879718, 1921286648, 2356205009, 1885780724, 980451116]],
];

function sample(count: number, draw: () => number) {
  const values = Array.from({ length: count }, draw);
  const average = values.reduce((sum, value) => sum + value, 0) / count;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (count - 1);
  return { values, average, variance };
}

describe("createRandom", () => {
  for (const [seed, expected] of referenceVectors) {
    it(`matches the reference stream for seed ${seed}`, () => {
      const random = createRandom(seed);
      assert.deepEqual(Array.from({ length: 5 }, () => random.nextUint32()), expected);
    });
  }

  it("derives uniforms from the unsigned draws and keeps them in [0, 1)", () => {
    assert.equal(createRandom(42).nextUniform(), 2837322924 / 2 ** 32);
    const random = createRandom(7);
    for (let index = 0; index < 10_000; index += 1) {
      const value = random.nextUniform();
      assert.ok(value >= 0 && value < 1);
    }
  });

  it("is reproducible from the seed and differs between seeds", () => {
    const first = createRandom(5);
    const second = createRandom(5);
    const other = createRandom(6);
    const draws = Array.from({ length: 20 }, () => [first.nextUint32(), second.nextUint32(), other.nextUint32()]);
    assert.ok(draws.every(([a, b]) => a === b));
    assert.ok(draws.some(([a, , c]) => a !== c));
  });

  it("rejects seeds that are not unsigned 32-bit integers", () => {
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) {
      assert.throws(() => createRandom(seed), /seed/);
    }
  });

  it("draws bounded integers that are uniform", () => {
    const random = createRandom(11);
    const counts = new Array(6).fill(0);
    for (let index = 0; index < 60_000; index += 1) counts[random.nextInt(6)] += 1;
    for (const count of counts) assert.ok(Math.abs(count - 10_000) < 400, `count ${count}`);
    assert.equal(createRandom(1).nextInt(1), 0);
    assert.throws(() => random.nextInt(0), /nextInt/);
    assert.throws(() => random.nextInt(2.5), /nextInt/);
  });

  it("avoids modulo bias for a bound that does not divide 2^32", () => {
    // Without rejection, residues below 2^31 would appear twice as often and the mean would sit near n / 4.
    const n = 2 ** 31 + 1;
    const random = createRandom(3);
    const { average } = sample(4000, () => random.nextInt(n));
    assert.ok(Math.abs(average / n - 0.5) < 0.05, `mean ratio ${average / n}`);
  });
});

describe("distributions", () => {
  it("draws standard normals with mean 0 and variance 1", () => {
    const random = createRandom(21);
    const { average, variance } = sample(100_000, () => nextStandardNormal(random));
    assert.ok(Math.abs(average) < 0.02, `mean ${average}`);
    assert.ok(Math.abs(variance - 1) < 0.03, `variance ${variance}`);
  });

  it("consumes two uniforms per normal, whatever was drawn before", () => {
    const random = createRandom(9);
    const reference = createRandom(9);
    for (let index = 0; index < 50; index += 1) {
      nextStandardNormal(random);
      reference.nextUniform();
      reference.nextUniform();
    }
    assert.equal(random.nextUint32(), reference.nextUint32());
  });

  it("draws gamma variables with mean and variance equal to the shape", () => {
    const random = createRandom(31);
    const { values, average, variance } = sample(100_000, () => nextGamma(random, 2.5));
    assert.ok(values.every((value) => value > 0));
    assert.ok(Math.abs(average - 2.5) < 0.04, `mean ${average}`);
    assert.ok(Math.abs(variance - 2.5) < 0.1, `variance ${variance}`);
    assert.throws(() => nextGamma(random, 0.5), /shape/);
  });

  it("draws chi-square variables with mean nu and variance 2 nu", () => {
    const random = createRandom(41);
    const { average, variance } = sample(100_000, () => nextChiSquare(random, 7));
    assert.ok(Math.abs(average - 7) < 0.06, `mean ${average}`);
    assert.ok(Math.abs(variance - 14) < 0.5, `variance ${variance}`);
  });
});
