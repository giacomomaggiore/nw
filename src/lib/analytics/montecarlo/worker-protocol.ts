import type { Overrides, Portfolio } from "./accounting";
import type { Summary } from "./summary";
import type { MonthlyDataset, ScenarioSettings } from "./types";

export type WorkerRunRequest = {
  type: "run";
  runId: number;
  dataset: MonthlyDataset;
  settings: ScenarioSettings;
  portfolio: Portfolio;
  overrides: Overrides;
};

export type WorkerRecalculateRequest = {
  type: "recalculate";
  runId: number;
  portfolio: Portfolio;
  overrides: Overrides;
};

export type WorkerRequest = WorkerRunRequest | WorkerRecalculateRequest;
export type WorkerResponse =
  | { type: "result"; runId: number; summary: Summary }
  | { type: "error"; runId: number; error: string };
