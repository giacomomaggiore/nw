import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextChiSquare, nextStandardNormal } from "@/lib/analytics/montecarlo/distributions";
import { quantile } from "@/lib/analytics/montecarlo/quantiles";
import { createRandom } from "@/lib/analytics/montecarlo/random";
import {
  covarianceMatrix,
  estimateNu,
  mean,
  pooledExcessKurtosis,
  standardDeviation,
} from "@/lib/analytics/montecarlo/statistics";

function near(actual: number, expected: number, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`);
}

describe("statistics", () => {
  it("computes the mean and the sample standard deviation", () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    near(mean(values), 5);
    near(standardDeviation(values), Math.sqrt(32 / 7));
  });

  it("computes the unbiased covariance matrix", () => {
    assert.deepEqual(covarianceMatrix([[1, 2, 3], [2, 4, 6]]), [[1, 2], [2, 4]]);
  });

  it("measures the excess kurtosis of a two-point distribution as -2", () => {
    near(pooledExcessKurtosis([[-1, 1, -1, 1]]), -2);
  });

  it("estimates 100 degrees of freedom for normal data", () => {
    const random = createRandom(5);
    const column = Array.from({ length: 20_000 }, () => nextStandardNormal(random));
    assert.ok(estimateNu([column]) > 50);
  });

  it("estimates a low number of degrees of freedom for fat-tailed data", () => {
    const random = createRandom(6);
    const column = Array.from({ length: 50_000 }, () => nextStandardNormal(random) / Math.sqrt(nextChiSquare(random, 8) / 8));
    const nu = estimateNu([column]);
    assert.ok(nu >= 5 && nu < 20, `nu ${nu}`);
  });

  it("clamps the degrees of freedom to 5 when a single outlier dominates", () => {
    assert.equal(estimateNu([[...new Array(99).fill(0).map((_, index) => (index % 2 ? 0.01 : -0.01)), 100]]), 5);
  });
});

describe("quantile", () => {
  it("interpolates linearly between order statistics", () => {
    const sorted = [1, 2, 3, 4];
    near(quantile(sorted, 0), 1);
    near(quantile(sorted, 0.25), 1.75);
    near(quantile(sorted, 0.5), 2.5);
    near(quantile(sorted, 1), 4);
    near(quantile([7], 0.9), 7);
  });

  it("rejects an empty sample", () => {
    assert.throws(() => quantile([], 0.5), /at least one value/);
  });
});
