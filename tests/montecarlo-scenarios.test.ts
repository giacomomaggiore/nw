import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_MONTHS, generateScenarios, maxPaths } from "@/lib/analytics/montecarlo/scenarios";
import { covarianceMatrix, mean } from "@/lib/analytics/montecarlo/statistics";
import type { MonthlyDataset, ScenarioSettings, Scenarios } from "@/lib/analytics/montecarlo/types";
import { syntheticDataset } from "./support/montecarlo-data";

const bootstrap = (overrides: Partial<ScenarioSettings> = {}): ScenarioSettings => ({
  seed: 42,
  paths: 20,
  months: 36,
  engine: { engine: "bootstrap", blockLength: 12 },
  ...overrides,
});

const studentT = (nu: number | null, overrides: Partial<ScenarioSettings> = {}): ScenarioSettings => ({
  seed: 42,
  paths: 20,
  months: 36,
  engine: { engine: "studentT", nu },
  ...overrides,
});

/** The values of one path and month: tickers, log inflation, risk-free. */
function month(scenarios: Scenarios, path: number, index: number) {
  const columns = scenarios.tickers.length + 2;
  const start = (path * scenarios.months + index) * columns;
  return Array.from(scenarios.values.slice(start, start + columns));
}

describe("dataset validation", () => {
  const dataset = syntheticDataset();

  it("rejects histories that are too short", () => {
    const short: MonthlyDataset = {
      ...dataset,
      dates: dataset.dates.slice(0, 59),
      assetReturns: dataset.assetReturns.map((returns) => returns.slice(0, 59)),
      inflation: dataset.inflation.slice(0, 59),
      riskFree: dataset.riskFree.slice(0, 59),
    };
    assert.throws(() => generateScenarios(short, bootstrap()), /at least 60/);
  });

  it("rejects invalid values and shapes without altering the data", () => {
    const copy = (change: (value: MonthlyDataset) => void) => {
      const value = structuredClone(dataset);
      change(value);
      return value;
    };
    assert.throws(() => generateScenarios(copy((value) => { value.assetReturns[1][3] = Number.NaN; }), bootstrap()), /T2/);
    assert.throws(() => generateScenarios(copy((value) => { value.assetReturns[0][3] = -1; }), bootstrap()), /T1/);
    assert.throws(() => generateScenarios(copy((value) => { value.riskFree[0] = Number.POSITIVE_INFINITY; }), bootstrap()), /risk-free/);
    assert.throws(() => generateScenarios(copy((value) => { value.dates[10] = value.dates[9]; }), bootstrap()), /increasing/);
    assert.throws(() => generateScenarios(copy((value) => { value.tickers[1] = "T1"; }), bootstrap()), /unique/);
    assert.throws(() => generateScenarios(copy((value) => { value.inflation.pop(); }), bootstrap()), /one value per date/);
  });
});

describe("generateScenarios settings", () => {
  const dataset = syntheticDataset();

  it("limits the paths by the stored scenario size", () => {
    assert.equal(maxPaths(120, 12), 20_000);
    assert.equal(maxPaths(480, 12), 5952);
    assert.equal(maxPaths(480, 3), 16_666);
    assert.throws(() => generateScenarios(dataset, bootstrap({ paths: 0 })), /paths/);
    assert.throws(() => generateScenarios(dataset, bootstrap({ months: 0 })), /horizon/);
    assert.throws(() => generateScenarios(dataset, bootstrap({ months: MAX_MONTHS + 1 })), /horizon/);
    assert.throws(() => generateScenarios(dataset, bootstrap({ paths: 20_001 })), /At most/);
  });

  it("validates the engine settings", () => {
    assert.throws(() => generateScenarios(dataset, bootstrap({ engine: { engine: "bootstrap", blockLength: 0 } })), /block length/);
    assert.throws(() => generateScenarios(dataset, bootstrap({ engine: { engine: "bootstrap", blockLength: 121 } })), /block length/);
    assert.throws(() => generateScenarios(dataset, studentT(4.9)), /degrees of freedom/);
    assert.throws(() => generateScenarios(dataset, studentT(100.1)), /degrees of freedom/);
  });
});

describe("block bootstrap", () => {
  const dataset = syntheticDataset();
  const rows = dataset.dates.length;
  // Every history row has a distinct first-ticker return, so a drawn month identifies its row.
  const rowOf = new Map(dataset.assetReturns[0].map((value, row) => [Math.fround(value), row]));

  it("draws whole history rows in circular blocks of consecutive months", () => {
    const scenarios = generateScenarios(dataset, bootstrap({ paths: 30, months: 36 }));
    let wrapped = false;
    for (let path = 0; path < scenarios.paths; path += 1) {
      let previousRow = -1;
      for (let index = 0; index < scenarios.months; index += 1) {
        const drawn = month(scenarios, path, index);
        const row = rowOf.get(drawn[0]);
        assert.notEqual(row, undefined);
        const expected = [
          ...dataset.assetReturns.map((returns) => Math.fround(returns[row!])),
          Math.fround(dataset.inflation[row!]),
          Math.fround(dataset.riskFree[row!]),
        ];
        assert.deepEqual(drawn, expected);
        if (index % 12 !== 0) {
          assert.equal(row, (previousRow + 1) % rows);
          if (row === 0) wrapped = true;
        }
        previousRow = row!;
      }
    }
    assert.ok(wrapped, "no block wrapped around the end of the history");
  });

  it("is reproducible and changes with the seed", () => {
    const first = generateScenarios(dataset, bootstrap());
    assert.deepEqual(generateScenarios(dataset, bootstrap()).values, first.values);
    assert.notDeepEqual(generateScenarios(dataset, bootstrap({ seed: 43 })).values, first.values);
  });

  it("keeps the first paths when more paths are requested", () => {
    const few = generateScenarios(dataset, bootstrap({ paths: 10 }));
    const many = generateScenarios(dataset, bootstrap({ paths: 25 }));
    assert.deepEqual(many.values.slice(0, few.values.length), few.values);
  });

  it("averages to the historical mean over many draws", () => {
    const scenarios = generateScenarios(dataset, bootstrap({ paths: 400, months: 60 }));
    const columns = dataset.tickers.length + 2;
    let sum = 0;
    for (let offset = 0; offset < scenarios.values.length; offset += columns) sum += scenarios.values[offset];
    assert.ok(Math.abs(sum / (400 * 60) - mean(dataset.assetReturns[0])) < 0.002);
  });

  it("reports the history it used and no tail parameters", () => {
    const { details } = generateScenarios(dataset, bootstrap());
    assert.equal(details.historyMonths, 120);
    assert.equal(details.nu, null);
    assert.equal(details.correlationRepaired, null);
    assert.equal(details.engineVersion, "block-bootstrap-v1");
    assert.equal(details.randomVersion, "xoshiro128**-v1");
  });
});

describe("parametric Student-t", () => {
  const dataset = syntheticDataset({ rows: 240 });
  const logColumns = dataset.assetReturns.map((returns) => returns.map(Math.log1p));

  /** Log returns of one ticker over every simulated path and month. */
  function simulatedLog(scenarios: Scenarios, ticker: number) {
    const columns = scenarios.tickers.length + 2;
    const values: number[] = [];
    for (let offset = ticker; offset < scenarios.values.length; offset += columns) values.push(Math.log1p(scenarios.values[offset]));
    return values;
  }

  it("matches the fitted mean and covariance, so the scale conversion is right", () => {
    const scenarios = generateScenarios(dataset, studentT(30, { paths: 4000, months: 60 }));
    const simulated = dataset.tickers.map((_, ticker) => simulatedLog(scenarios, ticker));
    const fitted = covarianceMatrix(logColumns);
    const observed = covarianceMatrix(simulated);
    observed.forEach((row, i) =>
      row.forEach((value, j) => assert.ok(Math.abs(value / fitted[i][j] - 1) < 0.05, `cov ${i},${j}: ${value} vs ${fitted[i][j]}`)),
    );
    simulated.forEach((values, ticker) => assert.ok(Math.abs(mean(values) - mean(logColumns[ticker])) < 5e-4));
  });

  it("has fatter tails than a normal distribution for low degrees of freedom", () => {
    const scenarios = generateScenarios(dataset, studentT(6, { paths: 4000, months: 60 }));
    const values = simulatedLog(scenarios, 0);
    const average = mean(values);
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
    const kurtosis = values.reduce((sum, value) => sum + (value - average) ** 4, 0) / values.length / variance ** 2;
    assert.ok(kurtosis - 3 > 1, `excess kurtosis ${kurtosis - 3}`);
  });

  it("keeps simulated simple returns above -100%", () => {
    const scenarios = generateScenarios(dataset, studentT(5, { paths: 500, months: 120 }));
    const columns = dataset.tickers.length + 2;
    for (let offset = 0; offset < scenarios.values.length; offset += columns) {
      for (let ticker = 0; ticker < dataset.tickers.length; ticker += 1) assert.ok(scenarios.values[offset + ticker] >= -1);
    }
  });

  it("is reproducible, estimates the degrees of freedom and reports them", () => {
    const first = generateScenarios(dataset, studentT(null));
    assert.deepEqual(generateScenarios(dataset, studentT(null)).values, first.values);
    assert.ok(first.details.nu !== null && first.details.nu >= 5 && first.details.nu <= 100);
    assert.equal(first.details.correlationRepaired, false);
    assert.equal(first.details.engineVersion, "parametric-student-t-v1");
    assert.equal(generateScenarios(dataset, studentT(12)).details.nu, 12);
  });

  it("keeps the first paths when more paths are requested", () => {
    const few = generateScenarios(dataset, studentT(20, { paths: 5 }));
    const many = generateScenarios(dataset, studentT(20, { paths: 12 }));
    assert.deepEqual(many.values.slice(0, few.values.length), few.values);
  });

  it("rejects a column without variance and perfectly collinear tickers", () => {
    const flatRate = { ...dataset, riskFree: dataset.riskFree.map(() => 0.003) };
    assert.throws(() => generateScenarios(flatRate, studentT(10)), /risk-free rate has no variance/);
    const duplicated: MonthlyDataset = {
      ...dataset,
      tickers: ["A", "B"],
      assetReturns: [dataset.assetReturns[0], dataset.assetReturns[0]],
    };
    assert.throws(() => generateScenarios(duplicated, studentT(10)), /not positive definite/);
  });
});
