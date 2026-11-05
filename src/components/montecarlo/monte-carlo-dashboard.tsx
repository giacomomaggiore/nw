"use client";

import { useEffect, useRef, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { boxedTooltipStyle, chartMargin, gridProps, lineCursor, xAxisProps, yAxisProps } from "@/components/charts/chart-style";
import type { Overrides } from "@/lib/analytics/montecarlo/accounting";
import type { Summary } from "@/lib/analytics/montecarlo/summary";
import type { WorkerResponse } from "@/lib/analytics/montecarlo/worker-protocol";
import { formatAxisValue, formatInteger, formatMoney, formatPercent } from "@/lib/format";
import type { MonteCarloControls, MonteCarloReport, MonteCarloSimulationData } from "@/types/montecarlo";

type MonteCarloDashboardProps = {
  report?: MonteCarloReport | null;
  simulation?: MonteCarloSimulationData | null;
  error?: string;
};

const inputClass = "w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

function MoneyMetric({ label, value, currency }: { label: string; value: number | null; currency: string }) {
  return <div className="border-l border-zinc-300 pl-4"><dt className="text-xs font-medium uppercase tracking-wider text-zinc-600">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-black">{formatMoney(value)} {value === null ? "" : currency}</dd></div>;
}

function ModelInputs({ inputs, onChange }: { inputs: MonteCarloControls; onChange: (inputs: MonteCarloControls) => void }) {
  const update = <K extends keyof MonteCarloControls>(key: K, value: MonteCarloControls[K]) => onChange({ ...inputs, [key]: value });
  return (
    <section className="border-y border-zinc-300 py-5" aria-labelledby="simulation-inputs-heading">
      <div className="mb-4"><h2 id="simulation-inputs-heading" className="text-xl font-medium tracking-tight text-black">Simulation inputs</h2><p className="mt-1 text-sm text-zinc-600">Changes run a new scenario in this browser.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium text-zinc-800">Horizon (years)<input className={inputClass} type="number" min="1" max="40" value={inputs.horizonYears} onChange={(event) => update("horizonYears", Number(event.target.value))} /></label>
        <label className="grid gap-1 text-sm font-medium text-zinc-800">Paths<input className={inputClass} type="number" min="1" step="100" value={inputs.paths} onChange={(event) => update("paths", Number(event.target.value))} /></label>
        <label className="grid gap-1 text-sm font-medium text-zinc-800">Engine<select className={inputClass} value={inputs.engine} onChange={(event) => update("engine", event.target.value as MonteCarloControls["engine"])}><option value="bootstrap">Block bootstrap</option><option value="student-t">Student-t</option></select></label>
        {inputs.engine === "bootstrap" && <label className="grid gap-1 text-sm font-medium text-zinc-800">Block length (months)<input className={inputClass} type="number" min="1" value={inputs.blockLength} onChange={(event) => update("blockLength", Number(event.target.value))} /></label>}
        <label className="grid gap-1 text-sm font-medium text-zinc-800">Seed<input className={inputClass} type="number" min="0" value={inputs.seed} onChange={(event) => update("seed", Number(event.target.value))} /></label>
      </div>
    </section>
  );
}

function buildReport(data: MonteCarloSimulationData, inputs: MonteCarloControls, summary: Summary): MonteCarloReport {
  const terminal = summary.horizons.at(-1);
  const fan = Array.from({ length: summary.months + 1 }, (_, month) => month).filter((month) => month % 12 === 0 || month === summary.months).map((month) => {
    const offset = month * 5;
    return { year: month / 12, paidIn: summary.paidIn[month], p10: summary.nominalBands[offset], p25: summary.nominalBands[offset + 1], median: summary.nominalBands[offset + 2], p75: summary.nominalBands[offset + 3], p90: summary.nominalBands[offset + 4] };
  });
  return {
    currency: data.currency, generatedAt: "Current browser run", inputs,
    successProbability: terminal ? 1 - terminal.lossProbability : null, successLabel: "Chance of ending above paid-in capital",
    terminalMedian: terminal?.nominal[2] ?? null, terminalP10: terminal?.nominal[0] ?? null, terminalP90: terminal?.nominal[4] ?? null, valueAtRisk: terminal?.nominal[0] ?? null,
    fan, scenarios: Array.from({ length: summary.samplePaths.count }, (_, path) => ({ label: `Path ${path + 1}`, values: fan.map((point) => summary.samplePaths.nominal[path * (summary.months + 1) + Math.round(point.year * 12)]) })),
    distribution: terminal ? terminal.nominalHistogram.counts.map((count, index) => ({ from: terminal.nominalHistogram.edges[index], to: terminal.nominalHistogram.edges[index + 1], count })) : [],
    horizons: summary.horizons.map((horizon) => ({ year: horizon.months / 12, p10: horizon.nominal[0], median: horizon.nominal[2], p90: horizon.nominal[4], lossProbability: horizon.lossProbability })),
    warnings: data.instruments.some((instrument) => instrument.proxy) ? ["Proxy history is included for at least one instrument."] : [],
  };
}

export function MonteCarloDashboard({ report: initialReport = null, simulation = null, error: initialError }: MonteCarloDashboardProps) {
  const [inputs, setInputs] = useState<MonteCarloControls | null>(initialReport?.inputs ?? (simulation ? { horizonYears: 20, paths: 5_000, engine: "bootstrap", blockLength: 6, seed: 1 } : null));
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState(initialError);
  const runId = useRef(0);
  const updateInputs = (next: MonteCarloControls) => { setInputs(next); setError(undefined); };

  useEffect(() => {
    if (!simulation || !inputs) return;
    const worker = new Worker(new URL("./simulation-worker.ts", import.meta.url));
    const id = ++runId.current;
    const overrides: Overrides = { expectedReturn: new Array(simulation.dataset.tickers.length).fill(null), volatility: new Array(simulation.dataset.tickers.length).fill(null), inflation: null, riskFree: null };
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.runId !== id) return;
      if (data.type === "error") setError(data.error);
      else setReport(buildReport(simulation, inputs, data.summary));
    };
    worker.postMessage({ type: "run", runId: id, dataset: simulation.dataset, settings: { paths: inputs.paths, months: inputs.horizonYears * 12, seed: inputs.seed, engine: inputs.engine === "bootstrap" ? { engine: "bootstrap", blockLength: inputs.blockLength } : { engine: "studentT", nu: null } }, portfolio: simulation.portfolio, overrides });
    return () => worker.terminate();
  }, [inputs, simulation]);

  if (!report || !inputs) {
    return (
      <section className="border border-zinc-300 bg-zinc-50 px-5 py-4" aria-labelledby="monte-carlo-unavailable-heading">
        <h2 id="monte-carlo-unavailable-heading" className="font-medium text-black">{simulation && !error ? "Running simulation" : "Simulation unavailable"}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-700">{error ?? "The Monte Carlo simulation is running in this browser."}</p>
      </section>
    );
  }

  const terminalYear = report.fan.at(-1)?.year ?? inputs.horizonYears;
  const fanData = report.fan.map((point) => ({ ...point, outerBand: point.p90 - point.p10 }));
  const distribution = report.distribution.map((bin) => ({ ...bin, label: `${formatAxisValue(bin.from)}–${formatAxisValue(bin.to)}` }));

  return (
    <div className="space-y-8">
      <section className="border-b-2 border-black pb-5" aria-labelledby="monte-carlo-heading">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-600">Forward-looking portfolio range</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 id="monte-carlo-heading" className="text-3xl font-semibold tracking-tight text-black">Monte Carlo</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">Historical market relationships generate possible paths, not a forecast or investment recommendation.</p></div><p className="text-xs tabular-nums text-zinc-500">Run {report.generatedAt}</p></div>
      </section>

      <dl className="grid gap-5 border-b border-zinc-300 pb-6 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyMetric label={`Median at year ${terminalYear}`} value={report.terminalMedian} currency={report.currency} />
        <MoneyMetric label="Downside (10th percentile)" value={report.terminalP10} currency={report.currency} />
        <MoneyMetric label="Upside (90th percentile)" value={report.terminalP90} currency={report.currency} />
        <MoneyMetric label="Value at risk" value={report.valueAtRisk} currency={report.currency} />
        <div className="border-l border-zinc-300 pl-4"><dt className="text-xs font-medium uppercase tracking-wider text-zinc-600">{report.successLabel}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-black">{formatPercent(report.successProbability, { digits: 1 })}</dd></div>
      </dl>

      <ModelInputs inputs={inputs} onChange={updateInputs} />

      <section aria-labelledby="fan-chart-heading"><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><div><h2 id="fan-chart-heading" className="text-xl font-medium tracking-tight text-black">Projected wealth range</h2><p className="mt-1 text-sm text-zinc-600">The central line is the median; bands show the 10th–90th percentile range.</p></div><span className="font-mono text-xs text-zinc-600">{report.currency}</span></div>
        {report.fan.length > 0 ? <div className="h-85 w-full" aria-label="Projected wealth percentile chart"><ResponsiveContainer><ComposedChart data={fanData} margin={chartMargin}><CartesianGrid {...gridProps} /><XAxis dataKey="year" {...xAxisProps} label={{ value: "Years", position: "insideBottomRight", offset: -2, fill: "#525252", fontSize: 11 }} /><YAxis {...yAxisProps} tickFormatter={formatAxisValue} /><Tooltip contentStyle={boxedTooltipStyle} cursor={lineCursor} formatter={(value, name) => [`${formatInteger(Number(value))} ${report.currency}`, name === "paidIn" ? "Paid in" : String(name)]} /><Area type="monotone" dataKey="p10" name="10th percentile" stackId="range" stroke="none" fill="#ffffff" isAnimationActive={false} /><Area type="monotone" dataKey="outerBand" name="10th–90th percentile" stackId="range" stroke="none" fill="#d4d4d8" isAnimationActive={false} /><Line type="monotone" dataKey="median" name="Median" stroke="#171717" strokeWidth={2.5} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="paidIn" name="Paid in" stroke="#a16207" strokeDasharray="5 3" dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div> : <p className="border border-zinc-300 px-4 py-3 text-sm text-zinc-700">No percentile path is available for this run.</p>}</section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="distribution-heading"><h2 id="distribution-heading" className="text-xl font-medium tracking-tight text-black">Terminal-value distribution</h2><p className="mt-1 text-sm text-zinc-600">Terminal values across all simulated paths.</p>{distribution.length > 0 ? <div className="mt-4 h-72" aria-label="Terminal value distribution"><ResponsiveContainer><BarChart data={distribution} margin={chartMargin}><CartesianGrid {...gridProps} /><XAxis dataKey="label" {...xAxisProps} /><YAxis {...yAxisProps} allowDecimals={false} /><Tooltip contentStyle={boxedTooltipStyle} formatter={(value) => [formatInteger(Number(value)), "Paths"]} /><Bar dataKey="count" name="Paths" fill="#27272a" isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <p className="mt-4 border border-zinc-300 px-4 py-3 text-sm text-zinc-700">No terminal distribution is available.</p>}</section>
        <section aria-labelledby="horizon-heading"><h2 id="horizon-heading" className="text-xl font-medium tracking-tight text-black">Horizon check</h2><p className="mt-1 text-sm text-zinc-600">Nominal wealth percentiles and chance of ending below contributions.</p><div className="mt-4 overflow-x-auto"><table className="w-full border-collapse text-right text-sm tabular-nums"><thead className="border-y border-zinc-300 text-xs uppercase tracking-wider text-zinc-600"><tr><th className="px-2 py-2 text-left font-medium">Year</th><th className="px-2 py-2 font-medium">10th</th><th className="px-2 py-2 font-medium">Median</th><th className="px-2 py-2 font-medium">90th</th><th className="px-2 py-2 font-medium">Loss</th></tr></thead><tbody>{report.horizons.map((horizon) => <tr key={horizon.year} className="border-b border-zinc-200"><th className="px-2 py-2 text-left font-medium text-black">{horizon.year}</th><td className="px-2 py-2">{formatInteger(horizon.p10)}</td><td className="px-2 py-2 font-medium">{formatInteger(horizon.median)}</td><td className="px-2 py-2">{formatInteger(horizon.p90)}</td><td className="px-2 py-2">{formatPercent(horizon.lossProbability, { digits: 1 })}</td></tr>)}</tbody></table></div></section>
      </div>

      {report.scenarios.length > 0 && <section className="border-t border-zinc-300 pt-6" aria-labelledby="scenarios-heading"><h2 id="scenarios-heading" className="text-xl font-medium tracking-tight text-black">Sequence of returns</h2><p className="mt-1 text-sm text-zinc-600">A small sample of paths shows how order changes the journey.</p><div className="mt-4 h-72" aria-label="Sample sequence of returns paths"><ResponsiveContainer><LineChart data={fanData.map((point, index) => ({ year: point.year, ...Object.fromEntries(report.scenarios.map((scenario) => [scenario.label, scenario.values[index] ?? null])) }))} margin={chartMargin}><CartesianGrid {...gridProps} /><XAxis dataKey="year" {...xAxisProps} /><YAxis {...yAxisProps} tickFormatter={formatAxisValue} /><Tooltip contentStyle={boxedTooltipStyle} cursor={lineCursor} formatter={(value, name) => [`${formatInteger(Number(value))} ${report.currency}`, String(name)]} />{report.scenarios.map((scenario, index) => <Line key={scenario.label} type="monotone" dataKey={scenario.label} stroke={["#171717", "#2563eb", "#a16207", "#7c3aed"][index % 4]} strokeWidth={index === 0 ? 2.5 : 1.5} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div></section>}

      {report.warnings.length > 0 && <section className="border border-zinc-300 bg-zinc-50 px-4 py-3" aria-labelledby="monte-carlo-warnings-heading"><h2 id="monte-carlo-warnings-heading" className="font-medium text-black">Data quality</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}
    </div>
  );
}
