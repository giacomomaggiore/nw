import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { account, noOverrides, type Overrides, type Portfolio } from "@/lib/analytics/montecarlo/accounting";
import { generateScenarios } from "@/lib/analytics/montecarlo/scenarios";
import { mean, standardDeviation } from "@/lib/analytics/montecarlo/statistics";
import type { MonthlyDataset, ScenarioSettings } from "@/lib/analytics/montecarlo/types";
import { manualScenarios, syntheticDataset } from "./support/montecarlo-data";

function portfolio(values: number[], extra: Partial<Portfolio> = {}): Portfolio {
  return { values, cash: 0, constantValue: 0, weights: null, ...extra };
}

function near(actual: number, expected: number, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`);
}

// Returns such as 0.5, -0.25 and 0.125 are exact in Float32, so the hand-calculated wealth is exact too.
describe("account", () => {
  it("compounds one asset month by month", () => {
    const scenarios = manualScenarios({ tickers: ["A"], returns: [[[0.5], [-0.25], [0.125]]] });
    const result = account(scenarios, portfolio([1000]), noOverrides(1));
    assert.deepEqual(Array.from(result.wealth), [1000, 1500, 1125, 1265.625]);
    assert.equal(result.startingWealth, 1000);
    assert.deepEqual(Array.from(result.paidIn), [1000, 1000, 1000, 1000]);
  });

  it("lets holdings drift from their starting weights, path by path", () => {
    const scenarios = manualScenarios({
      tickers: ["A", "B"],
      returns: [
        [[0.5, -0.5], [0, 0.25]],
        [[0, 0], [0, 0]],
      ],
    });
    // Month-major layout: index `month * paths + path`.
    const current = account(scenarios, portfolio([600, 400]), noOverrides(2));
    assert.deepEqual(Array.from(current.wealth), [1000, 1000, 1100, 1000, 1150, 1000]);

    const equal = account(scenarios, portfolio([600, 400], { weights: [0.5, 0.5] }), noOverrides(2));
    assert.deepEqual(Array.from(equal.wealth), [1000, 1000, 1000, 1000, 1062.5, 1000]);
  });

  it("grows cash at the risk-free rate and keeps the constant value fixed", () => {
    const scenarios = manualScenarios({ tickers: ["A"], returns: [[[0], [0]]], riskFree: 0.25 });
    const result = account(scenarios, portfolio([1000], { cash: 800, constantValue: 200 }), noOverrides(1));
    assert.deepEqual(Array.from(result.wealth), [2000, 2200, 2450]);
  });

  it("keeps wealth constant when nothing moves", () => {
    const scenarios = manualScenarios({ tickers: ["A", "B"], returns: [[[0, 0], [0, 0], [0, 0]]] });
    const result = account(scenarios, portfolio([300, 700], { cash: 100, constantValue: 50 }), noOverrides(2));
    assert.ok(Array.from(result.wealth).every((value) => value === 1150));
  });

  it("builds the price level from the inflation draws", () => {
    const scenarios = manualScenarios({ tickers: ["A"], returns: [[[0], [0]]], inflation: Math.LN2 });
    const result = account(scenarios, portfolio([1000]), noOverrides(1));
    assert.equal(result.priceLevel[0], 1);
    near(result.priceLevel[1], 2, 1e-6);
    near(result.priceLevel[2], 4, 1e-6);
  });

  it("is deterministic and independent of earlier calls", () => {
    const scenarios = manualScenarios({ tickers: ["A"], returns: [[[0.5], [-0.25]], [[0.125], [0]]] });
    const first = account(scenarios, portfolio([1000]), noOverrides(1));
    account(scenarios, portfolio([5000], { cash: 10 }), noOverrides(1));
    assert.deepEqual(account(scenarios, portfolio([1000]), noOverrides(1)).wealth, first.wealth);
  });
});

describe("account overrides", () => {
  const mean12 = 0.01;
  const sd = 0.04;

  it("moves the expected return to the annual geometric return", () => {
    // Every month equals the historical mean log return, so the override alone decides the growth.
    const monthly = new Array(12).fill([Math.expm1(mean12)]);
    const scenarios = manualScenarios({ tickers: ["A"], returns: [monthly], logMean: [mean12], logSd: [sd] });
    const result = account(scenarios, portfolio([1000]), { ...noOverrides(1), expectedReturn: [0.08] });
    near(result.wealth[12], 1080, 1e-3);
  });

  it("rescales the deviations from the mean when the volatility is overridden", () => {
    const scenarios = manualScenarios({
      tickers: ["A"],
      returns: [[[Math.expm1(mean12 + sd)], [Math.expm1(mean12 - sd)]]],
      logMean: [mean12],
      logSd: [sd],
    });
    // Twice the monthly volatility: log returns become mean +/- 2 sd, so the mean log return is unchanged.
    const result = account(scenarios, portfolio([1000]), { ...noOverrides(1), volatility: [(2 * sd) * Math.sqrt(12)] });
    near(result.wealth[2], 1000 * Math.exp(2 * mean12), 1e-2);
    near(result.wealth[1], 1000 * Math.exp(mean12 + 2 * sd), 1e-2);
  });

  it("replaces inflation and the risk-free rate with constants", () => {
    const scenarios = manualScenarios({
      tickers: ["A"],
      returns: [new Array(12).fill([0])],
      inflation: 0.5,
      riskFree: 0.5,
    });
    const result = account(scenarios, portfolio([0], { cash: 1000 }), { ...noOverrides(1), inflation: 0.03, riskFree: 0.05 });
    near(result.wealth[12], 1050, 1e-3);
    near(result.priceLevel[12], 1.03, 1e-6);
  });

  it("rejects values outside their range", () => {
    const scenarios = manualScenarios({ tickers: ["A"], returns: [[[0]]] });
    const run = (change: Partial<Overrides>, value: Partial<Portfolio> = {}) =>
      account(scenarios, portfolio([100], value), { ...noOverrides(1), ...change });
    assert.throws(() => run({ expectedReturn: [-1] }), /expected return/);
    assert.throws(() => run({ volatility: [-0.1] }), /volatility/);
    assert.throws(() => run({ inflation: -1 }), /Inflation/);
    assert.throws(() => run({ riskFree: -1 }), /risk-free/);
    assert.throws(() => run({}, { weights: [0.6] }), /total 100%/);
    assert.throws(() => run({}, { cash: -1 }), /non-negative/);
    assert.throws(() => account(scenarios, portfolio([100, 100]), noOverrides(1)), /one entry per simulated ticker/);
  });
});

describe("applying overrides to stored scenarios", () => {
  const dataset = syntheticDataset({ rows: 180 });
  const overrides: Overrides = {
    expectedReturn: [0.07, null, null],
    volatility: [0.2, 0.1, null],
    inflation: null,
    riskFree: null,
  };
  const invested = portfolio([5000, 3000, 2000], { cash: 1000, constantValue: 500 });

  /** The history itself rewritten with the overridden mean and volatility of each ticker's log returns. */
  function overriddenHistory(): MonthlyDataset {
    const assetReturns = dataset.assetReturns.map((returns, index) => {
      const logs = returns.map(Math.log1p);
      const average = mean(logs);
      const deviation = standardDeviation(logs);
      const expected = overrides.expectedReturn[index];
      const volatility = overrides.volatility[index];
      const targetMean = expected === null ? average : Math.log1p(expected) / 12;
      const targetSd = volatility === null ? deviation : volatility / Math.sqrt(12);
      return logs.map((value) => Math.expm1(targetMean + (targetSd / deviation) * (value - average)));
    });
    return { ...dataset, assetReturns };
  }

  function maxRelativeDifference(a: Float64Array, b: Float64Array) {
    let worst = 0;
    a.forEach((value, index) => {
      worst = Math.max(worst, Math.abs(value - b[index]) / Math.abs(value));
    });
    return worst;
  }

  const engines: Array<[string, ScenarioSettings["engine"]]> = [
    ["bootstrap", { engine: "bootstrap", blockLength: 12 }],
    ["Student-t", { engine: "studentT", nu: null }],
  ];

  for (const [name, engine] of engines) {
    it(`equals generating from the overridden history at the same seed (${name})`, () => {
      const settings: ScenarioSettings = { seed: 77, paths: 60, months: 60, engine };
      const after = account(generateScenarios(dataset, settings), invested, overrides);
      const before = account(generateScenarios(overriddenHistory(), settings), invested, noOverrides(3));
      assert.ok(maxRelativeDifference(before.wealth, after.wealth) < 1e-4);

      // Guard against a vacuous comparison: the overrides really change the outcome.
      const plain = account(generateScenarios(dataset, settings), invested, noOverrides(3));
      assert.ok(maxRelativeDifference(plain.wealth, after.wealth) > 0.01);
    });
  }
});
