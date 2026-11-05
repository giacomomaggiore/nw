// Synthetic histories for the Monte Carlo tests. They use their own small generator, not the code under test.
import type { Scenarios } from "@/lib/analytics/montecarlo/types";
import type { MonthlyDataset } from "@/lib/analytics/montecarlo/types";

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}

function normals(seed: number) {
  const uniform = lcg(seed);
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/**
 * Correlated, fat-tailed monthly returns: one common factor with a crash every 17th month plus independent noise.
 * Inflation and the risk-free rate vary a little, so no column is constant.
 */
export function syntheticDataset({ rows = 120, tickers = 3, seed = 1 } = {}): MonthlyDataset {
  const normal = normals(seed);
  const names = Array.from({ length: tickers }, (_, index) => `T${index + 1}`);
  const assetReturns: number[][] = names.map(() => []);
  const dates: string[] = [];
  const inflation: number[] = [];
  const riskFree: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    dates.push(new Date(Date.UTC(2005, row + 1, 0)).toISOString().slice(0, 10));
    const factor = row % 17 === 5 ? -0.07 : 0.004 + 0.04 * normal();
    names.forEach((_, index) => {
      const loading = 0.6 + 0.4 * index;
      assetReturns[index].push(Math.expm1(0.002 * index + loading * factor + (0.015 + 0.01 * index) * normal()));
    });
    inflation.push(0.002 + 0.001 * normal());
    riskFree.push(0.003 + 0.0005 * Math.abs(normal()));
  }
  return { dates, tickers: names, assetReturns, inflation, riskFree };
}

/** Hand-built scenarios: `returns[path][month]` lists the ticker returns of that month. */
export function manualScenarios({
  tickers,
  returns,
  inflation = 0,
  riskFree = 0,
  logMean,
  logSd,
}: {
  tickers: string[];
  returns: number[][][];
  inflation?: number;
  riskFree?: number;
  logMean?: number[];
  logSd?: number[];
}): Scenarios {
  const paths = returns.length;
  const months = returns[0].length;
  const columns = tickers.length + 2;
  const values = new Float32Array(paths * months * columns);
  returns.forEach((path, p) =>
    path.forEach((month, m) => {
      const offset = (p * months + m) * columns;
      values.set(month, offset);
      values[offset + tickers.length] = inflation;
      values[offset + tickers.length + 1] = riskFree;
    }),
  );
  return {
    paths,
    months,
    tickers,
    values,
    logMean: logMean ?? tickers.map(() => 0),
    logSd: logSd ?? tickers.map(() => 1),
    details: { randomVersion: "test", engineVersion: "test", historyMonths: 0, nu: null, correlationRepaired: null },
  };
}
