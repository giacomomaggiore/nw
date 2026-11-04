"use client";

import { useState } from "react";
import { ReportFilters } from "@/components/ui/report-filters";
import { useReportRange } from "@/components/ui/use-report-range";
import type { CashflowReport } from "@/lib/analytics/cashflow";
import { monthStart } from "@/lib/dates";
import { CashflowSummary } from "./cashflow-summary-table";
import { CashflowTrendChart } from "./cashflow-trend-chart";
import { ExpenseInsights } from "./expense-insights";
import { HistoricalExpenses } from "./historical-expenses";
import { useExpenseInsights } from "./use-expense-insights";

/**
 * `reports` holds one report per reporting currency. `reportingDate` is supplied by the server so the first render
 * and hydration agree on which months are over.
 */
export function CashflowDashboard({
  reports,
  currency,
  reportingDate,
}: {
  reports: Record<string, CashflowReport>;
  currency: string;
  reportingDate: string;
}) {
  const [displayCurrency, setDisplayCurrency] = useState(currency);
  const report = reports[displayCurrency];
  // Averages and insights use complete months only; the trend chart also plots the month in progress.
  const cutoff = monthStart(reportingDate, -1);
  const chartCutoff = monthStart(reportingDate);
  const range = useReportRange({
    today: reportingDate,
    firstDate: report.periods[0]?.period ?? reportingDate,
    lastDate: reportingDate,
  });
  const insights = useExpenseInsights(report, reportingDate, range.rangeStart, range.rangeEnd);

  return (
    <div className="space-y-10">
      <ReportFilters
        currencies={Object.keys(reports)}
        selectedCurrency={displayCurrency}
        onCurrencyChange={setDisplayCurrency}
        range={range}
        minDate={report.periods[0]?.period ?? reportingDate}
        maxDate={`${reportingDate.slice(0, 4)}-12-31`}
      />
      <CashflowTrendChart
        report={report}
        rangeStart={range.rangeStart}
        rangeEnd={range.rangeEnd}
        cutoff={chartCutoff}
        currency={displayCurrency}
      />
      <CashflowSummary report={report} reportingDate={reportingDate} cutoff={cutoff} currency={displayCurrency} />
      <ExpenseInsights report={report} insights={insights} cutoff={cutoff} currency={displayCurrency} />
      <HistoricalExpenses
        periods={insights.periods}
        expensesByMonth={insights.expensesByMonth}
        categoryOptions={report.expenseCategories}
        parentOptions={report.parentCategories}
        currency={displayCurrency}
      />
    </div>
  );
}
