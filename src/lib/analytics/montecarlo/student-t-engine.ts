import { nextChiSquare, nextStandardNormal } from "./distributions";
import { cholesky, fromCorrelation, nearestCorrelation, toCorrelation } from "./matrix";
import type { Random } from "./random";
import { MAX_NU, MIN_NU, covarianceMatrix, estimateNu, mean } from "./statistics";
import type { MonthlyDataset, ScenarioEngine } from "./types";

export const STUDENT_T_VERSION = "parametric-student-t-v1";

/**
 * Multivariate Student-t on monthly log returns: l = mu + L z / sqrt(chi2 / nu), with z standard normal and L L' the
 * scale matrix. One chi-square draw per month is shared by every column, so a fat-tail month hits all assets together.
 * The columns are the tickers, then log inflation, then the log of one plus the risk-free rate.
 *
 * The fit uses the historical statistics only; return and volatility overrides are applied later on the stored
 * scenarios, which gives the same result as fitting the overridden history.
 */
export function createStudentTEngine(dataset: MonthlyDataset, nuSetting: number | null, random: Random) {
  const tickers = dataset.tickers.length;
  const columns = [
    ...dataset.assetReturns.map((returns) => returns.map(Math.log1p)),
    dataset.inflation,
    dataset.riskFree.map(Math.log1p),
  ];
  const size = columns.length;

  const names = [...dataset.tickers, "Inflation", "The risk-free rate"];
  // A constant column can still show a tiny positive floating-point variance, so test for it exactly.
  columns.forEach((column, index) => {
    if (column.every((value) => value === column[0])) {
      throw new Error(`${names[index]} has no variance.`);
    }
  });
  const covariance = covarianceMatrix(columns);
  if (nuSetting !== null && !(nuSetting >= MIN_NU && nuSetting <= MAX_NU)) {
    throw new Error(`The degrees of freedom must be between ${MIN_NU} and ${MAX_NU}.`);
  }
  // Tail thickness is read from the assets only: inflation and rates trend and would distort the kurtosis.
  const nu = nuSetting ?? estimateNu(columns.slice(0, tickers));

  // A Student-t with scale S has covariance S nu / (nu - 2); scale down so the simulated covariance matches.
  const scale = covariance.map((row) => row.map((value) => (value * (nu - 2)) / nu));
  const { correlation, sd } = toCorrelation(scale);
  const repair = nearestCorrelation(correlation);
  const factor = cholesky(fromCorrelation(repair.matrix, sd));

  const location = columns.map(mean);
  const factorFlat = Float64Array.from(factor.flat());
  const draws = new Float64Array(size);

  const engine: ScenarioEngine = {
    next(_month, out) {
      for (let index = 0; index < size; index += 1) draws[index] = nextStandardNormal(random);
      const mixing = Math.sqrt(nu / nextChiSquare(random, nu));
      for (let index = 0; index < size; index += 1) {
        let sum = 0;
        const rowStart = index * size;
        for (let k = 0; k <= index; k += 1) sum += factorFlat[rowStart + k] * draws[k];
        const logReturn = location[index] + mixing * sum;
        out[index] = index === tickers ? logReturn : Math.expm1(logReturn);
      }
    },
  };
  return { engine, nu, correlationRepaired: repair.repaired };
}
