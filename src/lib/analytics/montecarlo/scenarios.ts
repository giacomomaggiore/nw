import { BOOTSTRAP_VERSION, createBootstrapEngine } from "./bootstrap-engine";
import { validateDataset } from "./dataset";
import { RANDOM_VERSION, createRandom } from "./random";
import { mean, standardDeviation } from "./statistics";
import { STUDENT_T_VERSION, createStudentTEngine } from "./student-t-engine";
import type { MonthlyDataset, ScenarioEngine, ScenarioSettings, Scenarios } from "./types";

export const MAX_PATHS = 20_000;
export const MAX_MONTHS = 480;
/** Stored scenario values (Float32, about 160 MB at the cap): paths x months x (tickers + 2). */
export const MAX_SCENARIO_VALUES = 40_000_000;

/** The most paths allowed for a horizon and a number of tickers, for the "up to N paths" hint. */
export function maxPaths(months: number, tickers: number) {
  return Math.min(MAX_PATHS, Math.floor(MAX_SCENARIO_VALUES / (months * (tickers + 2))));
}

function validateSettings(settings: ScenarioSettings, tickers: number) {
  if (!Number.isInteger(settings.paths) || settings.paths < 1) {
    throw new Error("The number of paths must be a positive whole number.");
  }
  if (!Number.isInteger(settings.months) || settings.months < 1 || settings.months > MAX_MONTHS) {
    throw new Error(`The horizon must be a whole number of months from 1 to ${MAX_MONTHS}.`);
  }
  const limit = maxPaths(settings.months, tickers);
  if (settings.paths > limit) {
    throw new Error(`At most ${limit} paths are allowed for this horizon and number of tickers.`);
  }
}

/**
 * Draws every path of every month once, in path-major order from one random stream, so the first paths do not change
 * when more paths are requested. The same history, settings and seed always give the same scenarios.
 */
export function generateScenarios(dataset: MonthlyDataset, settings: ScenarioSettings): Scenarios {
  validateDataset(dataset);
  const tickers = dataset.tickers.length;
  validateSettings(settings, tickers);
  const random = createRandom(settings.seed);

  let engine: ScenarioEngine;
  let engineVersion: string;
  let nu: number | null = null;
  let correlationRepaired: boolean | null = null;
  switch (settings.engine.engine) {
    case "bootstrap":
      engine = createBootstrapEngine(dataset, settings.engine.blockLength, random);
      engineVersion = BOOTSTRAP_VERSION;
      break;
    case "studentT": {
      const fitted = createStudentTEngine(dataset, settings.engine.nu, random);
      engine = fitted.engine;
      engineVersion = STUDENT_T_VERSION;
      nu = fitted.nu;
      correlationRepaired = fitted.correlationRepaired;
      break;
    }
    default: {
      const unhandled: never = settings.engine;
      throw new Error(`Unknown engine: ${JSON.stringify(unhandled)}`);
    }
  }

  const columns = tickers + 2;
  const values = new Float32Array(settings.paths * settings.months * columns);
  const month = new Float64Array(columns);
  let offset = 0;
  for (let path = 0; path < settings.paths; path += 1) {
    for (let index = 0; index < settings.months; index += 1) {
      engine.next(index, month);
      values.set(month, offset);
      offset += columns;
    }
  }

  const logReturns = dataset.assetReturns.map((returns) => returns.map(Math.log1p));
  return {
    paths: settings.paths,
    months: settings.months,
    tickers: dataset.tickers,
    values,
    logMean: logReturns.map(mean),
    logSd: logReturns.map(standardDeviation),
    details: {
      randomVersion: RANDOM_VERSION,
      engineVersion,
      historyMonths: dataset.dates.length,
      nu,
      correlationRepaired,
    },
  };
}
