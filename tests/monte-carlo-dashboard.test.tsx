import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MonteCarloDashboard } from "@/components/montecarlo/monte-carlo-dashboard";
import type { MonteCarloReport } from "@/types/montecarlo";

const report: MonteCarloReport = {
  currency: "EUR",
  generatedAt: "05 Nov 2026",
  inputs: { horizonYears: 20, paths: 10_000, engine: "bootstrap", blockLength: 6, seed: 42 },
  successProbability: 0.76,
  successLabel: "Chance of ending above paid-in capital",
  terminalMedian: 420_000,
  terminalP10: 180_000,
  terminalP90: 810_000,
  valueAtRisk: 120_000,
  fan: [
    { year: 0, paidIn: 100_000, p10: 95_000, p25: 100_000, median: 105_000, p75: 110_000, p90: 120_000 },
    { year: 20, paidIn: 220_000, p10: 180_000, p25: 280_000, median: 420_000, p75: 600_000, p90: 810_000 },
  ],
  scenarios: [{ label: "Path 1", values: [105_000, 390_000] }, { label: "Path 2", values: [105_000, 470_000] }],
  distribution: [{ from: 100_000, to: 200_000, count: 500 }, { from: 200_000, to: 300_000, count: 800 }],
  horizons: [{ year: 10, p10: 140_000, median: 250_000, p90: 420_000, lossProbability: 0.12 }, { year: 20, p10: 180_000, median: 420_000, p90: 810_000, lossProbability: 0.08 }],
  warnings: ["Short proxy history limits confidence."],
};

describe("MonteCarloDashboard", () => {
  it("renders report metrics, editable inputs, charts and warnings", () => {
    const html = renderToStaticMarkup(<MonteCarloDashboard report={report} />);
    for (const text of ["Monte Carlo", "420,000 EUR", "Chance of ending above paid-in capital", "76%", "Simulation inputs", "Projected wealth range", "Terminal-value distribution", "Horizon check", "Short proxy history limits confidence."]) assert.match(html, new RegExp(text));
    assert.equal((html.match(/class="recharts-responsive-container"/g) ?? []).length, 2);
    assert.match(html, /value="10000"/);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  });

  it("explains when no report is available", () => {
    const html = renderToStaticMarkup(<MonteCarloDashboard report={null} error="Market history is unavailable." />);
    assert.match(html, /Simulation unavailable/);
    assert.match(html, /Market history is unavailable\./);
    assert.doesNotMatch(html, /recharts-responsive-container/);
  });

  it("links every aria-labelledby to an existing unique id", () => {
    const html = renderToStaticMarkup(<MonteCarloDashboard report={report} />);
    for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
  });
});
