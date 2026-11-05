/** Serializable Monte Carlo inputs and results passed from a server loader to the dashboard. */
import type { Portfolio } from "@/lib/analytics/montecarlo/accounting";
import type { MonthlyDataset } from "@/lib/analytics/montecarlo/types";

/** Data prepared by the server loader and consumed by the browser simulation worker. */
export type MonteCarloSimulationData = {
  currency: string;
  dataset: MonthlyDataset;
  portfolio: Portfolio;
  instruments: Array<{ ticker: string; name: string; value: number; proxy: boolean }>;
  historyStart: string;
  historyEnd: string;
};

export type MonteCarloControls = {
  horizonYears: number;
  paths: number;
  engine: "bootstrap" | "student-t";
  blockLength: number;
  seed: number;
};

export type MonteCarloFanPoint = {
  year: number;
  paidIn: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
};

export type MonteCarloScenario = {
  label: string;
  values: number[];
};

export type MonteCarloDistributionBin = {
  from: number;
  to: number;
  count: number;
};

export type MonteCarloHorizon = {
  year: number;
  p10: number;
  median: number;
  p90: number;
  lossProbability: number;
};

export type MonteCarloReport = {
  currency: string;
  generatedAt: string;
  inputs: MonteCarloControls;
  successProbability: number | null;
  successLabel: string;
  terminalMedian: number | null;
  terminalP10: number | null;
  terminalP90: number | null;
  valueAtRisk: number | null;
  fan: MonteCarloFanPoint[];
  scenarios: MonteCarloScenario[];
  distribution: MonteCarloDistributionBin[];
  horizons: MonteCarloHorizon[];
  warnings: string[];
};
