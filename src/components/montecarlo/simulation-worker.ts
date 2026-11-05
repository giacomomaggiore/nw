/// <reference lib="webworker" />
import { account } from "@/lib/analytics/montecarlo/accounting";
import { generateScenarios } from "@/lib/analytics/montecarlo/scenarios";
import { summarize } from "@/lib/analytics/montecarlo/summary";
import type { WorkerRequest, WorkerResponse } from "@/lib/analytics/montecarlo/worker-protocol";
import type { Scenarios } from "@/lib/analytics/montecarlo/types";

let scenarios: Scenarios | null = null;

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === "run") scenarios = generateScenarios(data.dataset, data.settings);
    if (!scenarios) throw new Error("Run the simulation before recalculating it.");
    const summary = summarize(account(scenarios, data.portfolio, data.overrides));
    self.postMessage({ type: "result", runId: data.runId, summary } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({
      type: "error",
      runId: data.runId,
      error: error instanceof Error ? error.message : "The simulation failed.",
    } satisfies WorkerResponse);
  }
};
