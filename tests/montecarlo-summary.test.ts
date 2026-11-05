import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Accounting } from "@/lib/analytics/montecarlo/accounting";
import { BAND_LEVELS, horizonMonths, summarize } from "@/lib/analytics/montecarlo/summary";

function near(actual: number, expected: number, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`);
}

/** Five paths over 24 months: flat 250 and price level 1, except at months 12 and 24. */
function fixture(): Accounting {
  const paths = 5;
  const months = 24;
  const wealth = new Float64Array((months + 1) * paths).fill(250);
  const priceLevel = new Float32Array((months + 1) * paths).fill(1);
  wealth.set([300, 100, 500, 200, 400], 12 * paths);
  wealth.set([10, 20, 30, 40, 50], 24 * paths);
  priceLevel.fill(2, 12 * paths, 13 * paths);
  priceLevel.fill(4, 24 * paths, 25 * paths);
  return { paths, months, startingWealth: 250, wealth, priceLevel, paidIn: new Float64Array(months + 1).fill(250) };
}

describe("horizonMonths", () => {
  it("lists the standard horizons inside the horizon plus the full horizon", () => {
    assert.deepEqual(horizonMonths(84), [12, 36, 60, 84]);
    assert.deepEqual(horizonMonths(120), [12, 36, 60, 120]);
    assert.deepEqual(horizonMonths(480), [12, 36, 60, 120, 240, 360, 480]);
    assert.deepEqual(horizonMonths(6), [6]);
  });
});

describe("summarize", () => {
  const summary = summarize(fixture());

  it("computes nominal and real percentiles at each horizon", () => {
    assert.deepEqual(summary.horizons.map((horizon) => horizon.months), [12, 24]);
    const [year, end] = summary.horizons;
    assert.deepEqual(BAND_LEVELS, [0.1, 0.25, 0.5, 0.75, 0.9]);
    year.nominal.forEach((value, index) => near(value, [140, 200, 300, 400, 460][index]));
    year.real.forEach((value, index) => near(value, [70, 100, 150, 200, 230][index]));
    end.nominal.forEach((value, index) => near(value, [14, 20, 30, 40, 46][index]));
    end.real.forEach((value, index) => near(value, [3.5, 5, 7.5, 10, 11.5][index]));
  });

  it("counts the paths below the paid-in amount as losses", () => {
    assert.equal(summary.horizons[0].lossProbability, 0.4);
    assert.equal(summary.horizons[1].lossProbability, 1);
  });

  it("stores bands for every month, equal to the horizon percentiles", () => {
    assert.equal(summary.nominalBands.length, 25 * BAND_LEVELS.length);
    assert.equal(summary.realBands.length, 25 * BAND_LEVELS.length);
    for (let level = 0; level < BAND_LEVELS.length; level += 1) {
      assert.equal(summary.nominalBands[level], 250);
      assert.equal(summary.nominalBands[12 * BAND_LEVELS.length + level], summary.horizons[0].nominal[level]);
      assert.equal(summary.realBands[12 * BAND_LEVELS.length + level], summary.horizons[0].real[level]);
    }
  });

  it("keeps the first paths for the sample-path overlay", () => {
    assert.equal(summary.samplePaths.count, 5);
    assert.equal(summary.samplePaths.nominal[12], 300);
    assert.equal(summary.samplePaths.real[12], 150);
    assert.equal(summarize(fixture(), { samplePaths: 2 }).samplePaths.count, 2);
  });

  it("builds histograms that count every path", () => {
    for (const horizon of summary.horizons) {
      for (const histogram of [horizon.nominalHistogram, horizon.realHistogram]) {
        assert.equal(histogram.counts.length, 40);
        assert.equal(histogram.edges.length, 41);
        assert.equal(histogram.counts.reduce((sum, count) => sum + count, 0), 5);
      }
    }
    assert.equal(summarize(fixture(), { histogramBins: 10 }).horizons[0].nominalHistogram.counts.length, 10);
  });

  it("puts identical values in the first bin without dividing by zero", () => {
    const flat = fixture();
    flat.wealth.fill(100, 12 * 5, 13 * 5);
    const { counts, edges } = summarize(flat).horizons[0].nominalHistogram;
    assert.equal(counts[0], 5);
    assert.ok(edges.every((edge) => edge === 100));
  });

  it("clamps outliers into the end bins so a long tail does not flatten the chart", () => {
    const paths = 1000;
    const months = 12;
    const wealth = new Float64Array((months + 1) * paths).fill(500);
    for (let path = 0; path < paths; path += 1) wealth[months * paths + path] = path + 1;
    wealth[months * paths + paths - 1] = 1e9;
    const { counts, edges } = summarize({
      paths,
      months,
      startingWealth: 500,
      wealth,
      priceLevel: new Float32Array((months + 1) * paths).fill(1),
      paidIn: new Float64Array(months + 1).fill(500),
    }).horizons[0].nominalHistogram;
    assert.equal(counts.reduce((sum, count) => sum + count, 0), paths);
    assert.ok(edges[edges.length - 1] < 1100);
    assert.ok(counts[counts.length - 1] >= 1);
  });
});
