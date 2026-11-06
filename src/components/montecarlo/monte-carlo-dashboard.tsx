"use client";

import { useRef, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { boxedTooltipStyle, chartMargin, gridProps, lineCursor, xAxisProps, yAxisProps } from "@/components/charts/chart-style";
import type { Overrides } from "@/lib/analytics/montecarlo/accounting";
import type { Summary } from "@/lib/analytics/montecarlo/summary";
import type { WorkerResponse } from "@/lib/analytics/montecarlo/worker-protocol";
import { formatAxisValue, formatInteger, formatMoney, formatPercent } from "@/lib/format";
import type { MonteCarloAssetInput, MonteCarloCashflow, MonteCarloControls, MonteCarloReport, MonteCarloSimulationData } from "@/types/montecarlo";

type MonteCarloDashboardProps = {
  report?: MonteCarloReport | null;
  simulation?: MonteCarloSimulationData | null;
  error?: string;
};

const inputClass = "w-full border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

function MoneyMetric({ label, value, currency }: { label: string; value: number | null; currency: string }) {
  return <div className="border-l border-zinc-300 pl-4"><dt className="text-xs font-medium uppercase tracking-wider text-zinc-600">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-black">{formatMoney(value)} {value === null ? "" : currency}</dd></div>;
}

const defaultControls = (): MonteCarloControls => ({
  horizonYears: 20,
  paths: 5_000,
  engine: "bootstrap",
  blockLength: 6,
  seed: 1,
  contributionFrequency: "monthly",
  rebalancing: "none",
  rebalancingEvery: 12,
  rebalancingBand: 0.05,
  taxRate: 0,
});

function NumberField({ label, value, onChange, min = 0, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; step?: number }) {
  return <label className="grid gap-1 text-sm font-medium text-zinc-800">{label}<input className={inputClass} type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function AssetInputs({ assets, onChange }: { assets: MonteCarloAssetInput[]; onChange: (assets: MonteCarloAssetInput[]) => void }) {
  const total = assets.reduce((sum, asset) => sum + asset.weight, 0);
  return <section aria-labelledby="portfolio-construction-heading">
    <div className="border-b border-zinc-300 pb-1"><h2 id="portfolio-construction-heading" className="font-semibold">Portfolio construction</h2></div>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="border-y border-zinc-300 text-left text-xs uppercase tracking-wider text-zinc-600"><tr><th className="px-2 py-1.5">Asset</th><th className="px-2 py-1.5">Expected return</th><th className="px-2 py-1.5">Volatility</th><th className="px-2 py-1.5">Weight</th></tr></thead>
        <tbody>{assets.map((asset, index) => <tr key={asset.ticker} className="border-b border-zinc-200">
          <th className="px-2 py-1.5 text-left font-medium text-black"><span className="block">{asset.ticker}</span><span className="font-normal text-zinc-600">{asset.name}</span></th>
          <td className="px-2 py-1.5"><input aria-label={`Expected return for ${asset.ticker}`} className={inputClass} type="number" step="0.1" value={(asset.expectedReturn * 100).toFixed(2)} onChange={(event) => onChange(assets.map((item, itemIndex) => itemIndex === index ? { ...item, expectedReturn: Number(event.target.value) / 100 } : item))} /></td>
          <td className="px-2 py-1.5"><input aria-label={`Volatility for ${asset.ticker}`} className={inputClass} type="number" min="0" step="0.1" value={(asset.volatility * 100).toFixed(2)} onChange={(event) => onChange(assets.map((item, itemIndex) => itemIndex === index ? { ...item, volatility: Number(event.target.value) / 100 } : item))} /></td>
          <td className="px-2 py-1.5"><input aria-label={`Weight for ${asset.ticker}`} className={inputClass} type="number" min="0" step="0.1" value={(asset.weight * 100).toFixed(2)} onChange={(event) => onChange(assets.map((item, itemIndex) => itemIndex === index ? { ...item, weight: Number(event.target.value) / 100 } : item))} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className={`mt-1 text-sm ${Math.abs(total - 1) < 0.0001 ? "text-zinc-600" : "font-medium text-red-700"}`}>Total: {(total * 100).toFixed(2)}% {Math.abs(total - 1) < 0.0001 ? "" : "(must be 100%)"}</p>
  </section>;
}

function CashflowInputs({ cashflows, onChange }: { cashflows: MonteCarloCashflow[]; onChange: (cashflows: MonteCarloCashflow[]) => void }) {
  return <section aria-labelledby="cashflow-heading">
    <div className="border-b border-zinc-300 pb-1"><h2 id="cashflow-heading" className="font-semibold">Annual cashflow</h2></div>
    <div className="mt-2 h-[420px] w-[360px] max-w-full overflow-auto"><table className="w-full table-fixed border-collapse text-sm">
      <colgroup><col className="w-14" /><col className="w-[110px]" /><col className="w-[110px]" /><col className="w-[90px]" /></colgroup>
      <thead className="sticky top-0 border-y border-zinc-300 bg-white text-left text-xs uppercase tracking-wider text-zinc-600"><tr><th className="px-2 py-1.5">Year</th><th className="px-2 py-1.5">Income</th><th className="px-2 py-1.5">Spending</th><th className="px-2 py-1.5">Net</th></tr></thead>
      <tbody>{cashflows.map((cashflow, index) => <tr key={cashflow.year} className="border-b border-zinc-200"><th className="px-2 py-1.5 text-left font-medium">{cashflow.year}</th><td className="px-2 py-1.5"><input aria-label={`Income for year ${cashflow.year}`} className={inputClass} type="number" min="0" step="100" value={cashflow.income} onChange={(event) => onChange(cashflows.map((item, itemIndex) => itemIndex === index ? { ...item, income: Number(event.target.value) } : item))} /></td><td className="px-2 py-1.5"><input aria-label={`Spending for year ${cashflow.year}`} className={inputClass} type="number" min="0" step="100" value={cashflow.spending} onChange={(event) => onChange(cashflows.map((item, itemIndex) => itemIndex === index ? { ...item, spending: Number(event.target.value) } : item))} /></td><td className="px-2 py-1.5 tabular-nums">{formatInteger(cashflow.income - cashflow.spending)}</td></tr>)}</tbody>
    </table></div>
  </section>;
}

function PortfolioSettings({ inputs, onChange }: { inputs: MonteCarloControls; onChange: (inputs: MonteCarloControls) => void }) {
  const update = <K extends keyof MonteCarloControls>(key: K, value: MonteCarloControls[K]) => onChange({ ...inputs, [key]: value });
  return <section aria-labelledby="portfolio-settings-heading">
    <div className="border-b border-zinc-300 pb-1"><h2 id="portfolio-settings-heading" className="font-semibold">Portfolio settings</h2></div>
    <div className="mt-2 grid gap-2">
      <label className="grid gap-1 text-sm font-medium text-zinc-800">Contribution frequency<select className={inputClass} value={inputs.contributionFrequency ?? "monthly"} onChange={(event) => update("contributionFrequency", event.target.value as MonteCarloControls["contributionFrequency"])}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></label>
      <label className="grid gap-1 text-sm font-medium text-zinc-800">Rebalancing<select className={inputClass} value={inputs.rebalancing ?? "none"} onChange={(event) => update("rebalancing", event.target.value as MonteCarloControls["rebalancing"])}><option value="none">None</option><option value="time">Every period</option><option value="bands">Tolerance bands</option></select></label>
      {inputs.rebalancing === "time" && <NumberField label="Rebalance every (months)" min={1} value={inputs.rebalancingEvery ?? 12} onChange={(value) => update("rebalancingEvery", value)} />}
      {inputs.rebalancing === "bands" && <NumberField label="Band width (%)" min={0} step={0.5} value={(inputs.rebalancingBand ?? 0.05) * 100} onChange={(value) => update("rebalancingBand", value / 100)} />}
      <NumberField label="Capital-gains tax rate (%)" min={0} step={0.5} value={(inputs.taxRate ?? 0) * 100} onChange={(value) => update("taxRate", value / 100)} />
    </div>
  </section>;
}

function ModelInputs({ inputs, onChange, currencies, selectedCurrency, onCurrencyChange }: { inputs: MonteCarloControls; onChange: (inputs: MonteCarloControls) => void; currencies?: string[]; selectedCurrency?: string; onCurrencyChange?: (currency: string) => void }) {
  const update = <K extends keyof MonteCarloControls>(key: K, value: MonteCarloControls[K]) => onChange({ ...inputs, [key]: value });
  return (
    <section aria-labelledby="simulation-inputs-heading">
      <div className="mb-2 border-b border-zinc-300 pb-1"><h2 id="simulation-inputs-heading" className="font-semibold">Simulation inputs</h2></div>
      <div className="grid gap-2 sm:grid-cols-2">
        {currencies && onCurrencyChange && <div className="grid gap-1 text-sm font-medium text-zinc-800"><span>Currency</span><div className="flex">{currencies.map((currency) => <button key={currency} type="button" aria-pressed={currency === selectedCurrency} onClick={() => onCurrencyChange(currency)} className={`flex-1 border px-3 py-1.5 text-sm font-medium ${currency === selectedCurrency ? "border-black bg-black text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>{currency}</button>)}</div></div>}
        <div className="grid gap-1 text-sm font-medium text-zinc-800"><span>Engine</span><div className="flex"><button type="button" aria-pressed={inputs.engine === "bootstrap"} onClick={() => update("engine", "bootstrap")} className={`flex-1 border px-3 py-1.5 text-sm font-medium ${inputs.engine === "bootstrap" ? "border-black bg-black text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>Bootstrap</button><button type="button" aria-pressed={inputs.engine === "student-t"} onClick={() => update("engine", "student-t")} className={`flex-1 border border-l-0 px-3 py-1.5 text-sm font-medium ${inputs.engine === "student-t" ? "border-black bg-black text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>Parametric</button></div></div>
        {inputs.engine === "bootstrap" && <NumberField label="Block length (months)" min={1} value={inputs.blockLength} onChange={(value) => update("blockLength", value)} />}
        <NumberField label="Random seed" value={inputs.seed} onChange={(value) => update("seed", value)} />
        <NumberField label="Simulated paths" min={1} step={100} value={inputs.paths} onChange={(value) => update("paths", value)} />
        <NumberField label="Horizon (years)" min={1} value={inputs.horizonYears} onChange={(value) => update("horizonYears", value)} />
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
  const [inputs, setInputs] = useState<MonteCarloControls | null>(initialReport?.inputs ?? (simulation ? defaultControls() : null));
  const [assets, setAssets] = useState<MonteCarloAssetInput[]>(() => simulation?.instruments.map((instrument, index) => ({ ...instrument, weight: (simulation.portfolio.values[index] ?? 0) / Math.max(1, simulation.portfolio.values.reduce((sum, value) => sum + value, 0)) })) ?? []);
  const [cashflows, setCashflows] = useState<MonteCarloCashflow[]>(() => Array.from({ length: inputs?.horizonYears ?? 20 }, (_, index) => ({ year: index + 1, income: 0, spending: 0 })));
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState(initialError);
  const [running, setRunning] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(simulation?.currency ?? initialReport?.currency ?? "");
  const runId = useRef(0);
  const updateInputs = (next: MonteCarloControls) => {
    if (inputs && next.horizonYears !== inputs.horizonYears) {
      setCashflows((current) => Array.from({ length: next.horizonYears }, (_, index) => current[index] ?? { year: index + 1, income: 0, spending: 0 }));
    }
    setInputs(next);
    setError(undefined);
  };
  const resultsRef = useRef<HTMLElement>(null);
  const activeSimulation = simulation && selectedCurrency
    ? {
        ...simulation,
        currency: selectedCurrency,
        dataset: simulation.datasets[selectedCurrency] ?? simulation.dataset,
        portfolio: simulation.portfolios[selectedCurrency] ?? simulation.portfolio,
        instruments: simulation.instrumentsByCurrency[selectedCurrency] ?? simulation.instruments,
      }
    : simulation;
  const selectCurrency = (currency: string) => {
    if (!simulation || currency === selectedCurrency) return;
    setSelectedCurrency(currency);
    const nextInstruments = simulation.instrumentsByCurrency[currency] ?? simulation.instruments;
    const nextPortfolio = simulation.portfolios[currency] ?? simulation.portfolio;
    setAssets(nextInstruments.map((instrument, index) => ({ ...instrument, weight: (nextPortfolio.values[index] ?? 0) / Math.max(1, nextPortfolio.values.reduce((sum, value) => sum + value, 0)) })));
    setReport(null);
    setError(undefined);
  };
  const runSimulation = () => {
    if (!activeSimulation || !inputs) return;
    if (Math.abs(assets.reduce((sum, asset) => sum + asset.weight, 0) - 1) > 0.0001) {
      setError("Asset weights must total 100%.");
      return;
    }
    setRunning(true);
    const worker = new Worker(new URL("./simulation-worker.ts", import.meta.url));
    const id = ++runId.current;
    const overrides: Overrides = {
      expectedReturn: activeSimulation.dataset.tickers.map((ticker) => assets.find((asset) => asset.ticker === ticker)?.expectedReturn ?? null),
      volatility: activeSimulation.dataset.tickers.map((ticker) => assets.find((asset) => asset.ticker === ticker)?.volatility ?? null),
      inflation: null,
      riskFree: null,
    };
    const portfolio = {
      ...activeSimulation.portfolio,
      values: activeSimulation.dataset.tickers.map((ticker) => assets.find((asset) => asset.ticker === ticker)?.value ?? 0),
      weights: activeSimulation.dataset.tickers.map((ticker) => assets.find((asset) => asset.ticker === ticker)?.weight ?? 0),
      cashflows: cashflows.map(({ income, spending }) => ({ income, spending })),
      contributionFrequency: inputs.contributionFrequency,
      rebalancing: inputs.rebalancing,
      rebalancingEvery: inputs.rebalancingEvery,
      rebalancingBand: inputs.rebalancingBand,
      taxRate: inputs.taxRate,
    };
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.runId !== id) return;
      setRunning(false);
      if (data.type === "error") setError(data.error);
      else {
        setReport(buildReport(activeSimulation, inputs, data.summary));
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
      worker.terminate();
    };
    worker.postMessage({ type: "run", runId: id, dataset: activeSimulation.dataset, settings: { paths: inputs.paths, months: inputs.horizonYears * 12, seed: inputs.seed, engine: inputs.engine === "bootstrap" ? { engine: "bootstrap", blockLength: inputs.blockLength } : { engine: "studentT", nu: null } }, portfolio, overrides });
  };

  const workspace = simulation && inputs ? <div className="grid gap-6 py-3 lg:grid-cols-[minmax(0,1.15fr)_360px_minmax(0,1fr)]">
    <AssetInputs assets={assets} onChange={setAssets} />
    <CashflowInputs cashflows={cashflows} onChange={setCashflows} />
    <div className="flex flex-col gap-4"><ModelInputs inputs={inputs} onChange={updateInputs} currencies={simulation.currencyOptions} selectedCurrency={selectedCurrency} onCurrencyChange={selectCurrency} /><PortfolioSettings inputs={inputs} onChange={updateInputs} /><button className="mt-auto self-end bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={running} onClick={runSimulation} type="button">{running ? "Running…" : "Run"}</button></div>
  </div> : null;

  if (!inputs || (!report && !simulation)) {
    return (
      <section className="border border-zinc-300 bg-zinc-50 px-5 py-4" aria-labelledby="monte-carlo-unavailable-heading">
        <h2 id="monte-carlo-unavailable-heading" className="font-medium text-black">{simulation && !error ? "Running simulation" : "Simulation unavailable"}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-700">{error ?? "The Monte Carlo simulation is running in this browser."}</p>
      </section>
    );
  }
  if (!report) return <div className="space-y-4"><section className="border-b-2 border-black pb-3" aria-labelledby="monte-carlo-heading"><h1 id="monte-carlo-heading" className="text-3xl font-semibold tracking-tight text-black">Monte Carlo</h1></section>{workspace}</div>;

  const terminalYear = report.fan.at(-1)?.year ?? inputs.horizonYears;
  const fanData = report.fan.map((point) => ({ ...point, outerBand: point.p90 - point.p10 }));
  const distribution = report.distribution.map((bin) => ({ ...bin, label: `${formatAxisValue(bin.from)}–${formatAxisValue(bin.to)}` }));

  return (
    <div className="space-y-8">
      <section className="border-b-2 border-black pb-3" aria-labelledby="monte-carlo-heading">
        <div className="flex flex-wrap items-end justify-between gap-2"><h1 id="monte-carlo-heading" className="text-3xl font-semibold tracking-tight text-black">Monte Carlo</h1><p className="text-xs tabular-nums text-zinc-500">Run {report.generatedAt}</p></div>
      </section>

      {workspace}
      <dl className="grid gap-5 pb-2 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyMetric label={`Median at year ${terminalYear}`} value={report.terminalMedian} currency={report.currency} />
        <MoneyMetric label="Downside (10th percentile)" value={report.terminalP10} currency={report.currency} />
        <MoneyMetric label="Upside (90th percentile)" value={report.terminalP90} currency={report.currency} />
        <MoneyMetric label="Value at risk" value={report.valueAtRisk} currency={report.currency} />
        <div className="border-l border-zinc-300 pl-4"><dt className="text-xs font-medium uppercase tracking-wider text-zinc-600">{report.successLabel}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-black">{formatPercent(report.successProbability, { digits: 1 })}</dd></div>
      </dl>

      {!simulation && <ModelInputs inputs={inputs} onChange={updateInputs} />}

      <section ref={resultsRef} aria-labelledby="fan-chart-heading"><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-300 pb-1"><div><h2 id="fan-chart-heading" className="text-xl font-medium tracking-tight text-black">Projected wealth range</h2><p className="mt-1 text-sm text-zinc-600">The central line is the median; bands show the 10th–90th percentile range.</p></div><span className="font-mono text-xs text-zinc-600">{report.currency}</span></div>
        {report.fan.length > 0 ? <div className="h-85 w-full" aria-label="Projected wealth percentile chart"><ResponsiveContainer><ComposedChart data={fanData.map((point, index) => ({ ...point, ...Object.fromEntries(report.scenarios.map((scenario) => [scenario.label, scenario.values[index] ?? null])) }))} margin={chartMargin}><CartesianGrid {...gridProps} /><XAxis dataKey="year" {...xAxisProps} label={{ value: "Years", position: "insideBottomRight", offset: -2, fill: "#525252", fontSize: 11 }} /><YAxis {...yAxisProps} tickFormatter={formatAxisValue} /><Tooltip contentStyle={boxedTooltipStyle} cursor={lineCursor} formatter={(value, name) => [`${formatInteger(Number(value))} ${report.currency}`, name === "paidIn" ? "Paid in" : String(name)]} /><Area type="monotone" dataKey="p10" name="10th percentile" stackId="range" stroke="none" fill="#ffffff" isAnimationActive={false} /><Area type="monotone" dataKey="outerBand" name="10th–90th percentile" stackId="range" stroke="none" fill="#d4d4d8" isAnimationActive={false} />{report.scenarios.map((scenario, index) => <Line key={scenario.label} type="monotone" dataKey={scenario.label} stroke={["#2563eb", "#7c3aed", "#0891b2", "#c2410c", "#16a34a"][index % 5]} strokeWidth={1} strokeOpacity={0.45} dot={false} isAnimationActive={false} />)}<Line type="monotone" dataKey="median" name="Median" stroke="#171717" strokeWidth={3} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="paidIn" name="Paid in" stroke="#a16207" strokeDasharray="5 3" dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div> : <p className="border border-zinc-300 px-4 py-3 text-sm text-zinc-700">No percentile path is available for this run.</p>}</section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="distribution-heading"><div className="border-b border-zinc-300 pb-1"><h2 id="distribution-heading" className="text-xl font-medium tracking-tight text-black">Terminal-value distribution</h2></div>{distribution.length > 0 ? <div className="mt-4 h-72" aria-label="Terminal value distribution"><ResponsiveContainer><BarChart data={distribution} margin={chartMargin}><CartesianGrid {...gridProps} /><XAxis dataKey="label" {...xAxisProps} /><YAxis {...yAxisProps} allowDecimals={false} /><Tooltip contentStyle={boxedTooltipStyle} formatter={(value) => [formatInteger(Number(value)), "Paths"]} /><Bar dataKey="count" name="Paths" fill="#27272a" isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <p className="mt-4 border border-zinc-300 px-4 py-3 text-sm text-zinc-700">No terminal distribution is available.</p>}</section>
        <section aria-labelledby="horizon-heading"><div className="border-b border-zinc-300 pb-1"><h2 id="horizon-heading" className="text-xl font-medium tracking-tight text-black">Horizon check</h2></div><div className="mt-4 overflow-x-auto"><table className="w-full border-collapse text-right text-sm tabular-nums"><thead className="border-y border-zinc-300 text-xs uppercase tracking-wider text-zinc-600"><tr><th className="px-2 py-2 text-left font-medium">Year</th><th className="px-2 py-2 font-medium">10th</th><th className="px-2 py-2 font-medium">Median</th><th className="px-2 py-2 font-medium">90th</th><th className="px-2 py-2 font-medium">Loss</th></tr></thead><tbody>{report.horizons.map((horizon) => <tr key={horizon.year} className="border-b border-zinc-200"><th className="px-2 py-2 text-left font-medium text-black">{horizon.year}</th><td className="px-2 py-2">{formatInteger(horizon.p10)}</td><td className="px-2 py-2 font-medium">{formatInteger(horizon.median)}</td><td className="px-2 py-2">{formatInteger(horizon.p90)}</td><td className="px-2 py-2">{formatPercent(horizon.lossProbability, { digits: 1 })}</td></tr>)}</tbody></table></div></section>
      </div>

      {report.warnings.length > 0 && <section className="border border-zinc-300 bg-zinc-50 px-4 py-3" aria-labelledby="monte-carlo-warnings-heading"><h2 id="monte-carlo-warnings-heading" className="font-medium text-black">Data quality</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}
    </div>
  );
}
