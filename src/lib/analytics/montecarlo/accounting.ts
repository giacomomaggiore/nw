import type { Scenarios } from "./types";

export type Portfolio = {
  /** Current value of each ticker in CURRENCY_1, in the order of `Scenarios.tickers`. */
  values: number[];
  cash: number;
  /** Manual assets the user adds as a fixed nominal amount that is not simulated. */
  constantValue: number;
  /** Starting weights of the invested part, summing to 1; null keeps the current weights. */
  weights: number[] | null;
  cashflows?: Array<{ income: number; spending: number }>;
  contributionFrequency?: "weekly" | "monthly" | "quarterly" | "annually";
  rebalancing?: "none" | "time" | "bands";
  rebalancingEvery?: number;
  rebalancingBand?: number;
  taxRate?: number;
};

/** Annual figures as fractions (0.06 = 6%). A null entry keeps the historical value. */
export type Overrides = {
  /** Annual geometric return of each ticker, net of costs. */
  expectedReturn: Array<number | null>;
  volatility: Array<number | null>;
  /** Constant annual inflation replacing the sampled one. */
  inflation: number | null;
  /** Constant annual risk-free rate replacing the sampled one. */
  riskFree: number | null;
};

export type Accounting = {
  paths: number;
  months: number;
  startingWealth: number;
  /** Nominal total wealth (tickers, cash and constant value), month-major: index `month * paths + path`. */
  wealth: Float64Array;
  /** Price level with 1 at month 0 and the same layout, so real wealth is `wealth / priceLevel`. */
  priceLevel: Float32Array;
  /** Starting wealth plus net external contributions, one value per month 0..months. */
  paidIn: Float64Array;
};

export function noOverrides(tickers: number): Overrides {
  return {
    expectedReturn: new Array(tickers).fill(null),
    volatility: new Array(tickers).fill(null),
    inflation: null,
    riskFree: null,
  };
}

function startingWeights(portfolio: Portfolio, invested: number) {
  if (portfolio.weights) {
    const total = portfolio.weights.reduce((sum, weight) => sum + weight, 0);
    if (portfolio.weights.some((weight) => !(weight >= 0)) || Math.abs(total - 1) > 1e-6) {
      throw new Error("The starting weights must be non-negative and total 100%.");
    }
    return portfolio.weights;
  }
  return portfolio.values.map((value) => (invested > 0 ? value / invested : 0));
}

/**
 * Per-ticker affine map of the monthly log return, l' = slope * l + intercept, that moves the historical mean and
 * volatility to the overridden ones. With no override it is the identity.
 */
function logReturnMaps(scenarios: Scenarios, overrides: Overrides) {
  return scenarios.tickers.map((_, index) => {
    const expected = overrides.expectedReturn[index];
    const volatility = overrides.volatility[index];
    if (expected !== null && !(expected > -1)) throw new Error("An expected return must be above -100%.");
    if (volatility !== null && !(volatility >= 0)) throw new Error("A volatility cannot be negative.");
    const targetMean = expected === null ? scenarios.logMean[index] : Math.log1p(expected) / 12;
    const targetSd = volatility === null ? scenarios.logSd[index] : volatility / Math.sqrt(12);
    const slope = targetSd / scenarios.logSd[index];
    return { slope, intercept: targetMean - slope * scenarios.logMean[index] };
  });
}

/**
 * Runs the portfolio over the stored scenarios: holdings drift with their returns (no rebalancing), cash earns the
 * risk-free rate, and the constant value stays fixed. Pure and deterministic, so it can be re-run on every edit.
 */
export function account(scenarios: Scenarios, portfolio: Portfolio, overrides: Overrides): Accounting {
  const { paths, months } = scenarios;
  const tickers = scenarios.tickers.length;
  const columns = tickers + 2;
  if (portfolio.values.length !== tickers || overrides.expectedReturn.length !== tickers || overrides.volatility.length !== tickers) {
    throw new Error("The portfolio and overrides need one entry per simulated ticker.");
  }
  if (![...portfolio.values, portfolio.cash, portfolio.constantValue].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Portfolio values must be finite and non-negative.");
  }
  if (overrides.inflation !== null && !(overrides.inflation > -1)) throw new Error("Inflation must be above -100%.");
  if (overrides.riskFree !== null && !(overrides.riskFree > -1)) throw new Error("The risk-free rate must be above -100%.");

  const invested = portfolio.values.reduce((sum, value) => sum + value, 0);
  const weights = startingWeights(portfolio, invested);
  const frequencyPeriods = { weekly: 52, monthly: 12, quarterly: 4, annually: 1 }[portfolio.contributionFrequency ?? "monthly"];
  const periodMonths = Math.max(1, Math.round(12 / frequencyPeriods));
  const cashflows = portfolio.cashflows ?? [];
  const rebalancing = portfolio.rebalancing ?? "none";
  const rebalancingEvery = Math.max(1, portfolio.rebalancingEvery ?? 12);
  const rebalancingBand = Math.max(0, portfolio.rebalancingBand ?? 0.05);
  const taxRate = Math.min(1, Math.max(0, portfolio.taxRate ?? 0));
  const maps = logReturnMaps(scenarios, overrides);
  const inflationStep = overrides.inflation === null ? null : Math.log1p(overrides.inflation) / 12;
  const riskFreeStep = overrides.riskFree === null ? null : (1 + overrides.riskFree) ** (1 / 12) - 1;

  const startingWealth = invested + portfolio.cash + portfolio.constantValue;
  const wealth = new Float64Array((months + 1) * paths);
  const priceLevel = new Float32Array((months + 1) * paths);
  const paidIn = new Float64Array(months + 1);
  paidIn[0] = startingWealth;
  const holdings = new Float64Array(tickers);

  for (let path = 0; path < paths; path += 1) {
    for (let ticker = 0; ticker < tickers; ticker += 1) holdings[ticker] = invested * weights[ticker];
    let cash = portfolio.cash;
    let contributed = startingWealth;
    let logPrice = 0;
    wealth[path] = startingWealth;
    priceLevel[path] = 1;

    for (let month = 1; month <= months; month += 1) {
      const base = (path * months + month - 1) * columns;
      let total = 0;
      for (let ticker = 0; ticker < tickers; ticker += 1) {
        let simple = scenarios.values[base + ticker];
        const { slope, intercept } = maps[ticker];
        if (slope !== 1 || intercept !== 0) simple = Math.expm1(slope * Math.log1p(simple) + intercept);
        holdings[ticker] *= 1 + simple;
        total += holdings[ticker];
      }
      cash *= 1 + (riskFreeStep ?? scenarios.values[base + tickers + 1]);
      logPrice += inflationStep ?? scenarios.values[base + tickers];

      const year = Math.min(Math.floor((month - 1) / 12), Math.max(0, cashflows.length - 1));
      if (month % periodMonths === 0 && cashflows.length > 0) {
        const net = (cashflows[year].income - cashflows[year].spending) / frequencyPeriods;
        if (net >= 0) {
          const amount = net;
          for (let ticker = 0; ticker < tickers; ticker += 1) holdings[ticker] += amount * weights[ticker];
          contributed += amount;
        } else {
          const withdrawal = Math.min(-net, total + cash);
          const taxable = Math.max(0, withdrawal - withdrawal * 0.5);
          const afterTax = withdrawal - taxable * taxRate;
          const ratio = total > 0 ? Math.min(1, afterTax / total) : 0;
          for (let ticker = 0; ticker < tickers; ticker += 1) holdings[ticker] *= 1 - ratio;
          cash = Math.max(0, cash - Math.max(0, afterTax - total));
          contributed -= withdrawal;
        }
      }

      if (rebalancing !== "none" && (rebalancing === "time" ? month % rebalancingEvery === 0 : true)) {
        const rebalanceTotal = holdings.reduce((sum, value) => sum + value, 0);
        const shouldRebalance = rebalancing === "time" || holdings.some((value, ticker) => {
          const actual = rebalanceTotal > 0 ? value / rebalanceTotal : 0;
          return Math.abs(actual - weights[ticker]) > rebalancingBand;
        });
        if (shouldRebalance && rebalanceTotal > 0) {
          for (let ticker = 0; ticker < tickers; ticker += 1) holdings[ticker] = rebalanceTotal * weights[ticker];
        }
      }

      const value = total + cash + portfolio.constantValue;
      if (!Number.isFinite(value)) {
        throw new Error(`Path ${path} has a wealth that is not finite in month ${month}.`);
      }
      wealth[month * paths + path] = holdings.reduce((sum, holding) => sum + holding, 0) + cash + portfolio.constantValue;
      priceLevel[month * paths + path] = Math.exp(logPrice);
      if (path === 0) paidIn[month] = contributed;
    }
  }

  return { paths, months, startingWealth, wealth, priceLevel, paidIn };
}
