"use client";

import { useMemo, useState } from "react";
import { tableCell, tableHead } from "@/components/ui/table-styles";
import { expensesExcluding, periodsInRange, type CashflowPeriod, type CashflowReport } from "@/lib/analytics/cashflow";
import { formatMoney, formatMonthDash, formatPercent } from "@/lib/format";

type RowVariant = "category" | "total" | "bold";

// Fixed label column (w-52 = 208px) plus a minimum width per month, total and average column: narrow screens scroll the table.
const LABEL_COLUMN_WIDTH = 208;
const VALUE_COLUMN_WIDTH = 68;

function sum(values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** Monthly average over every given month; months without data count as zero. */
function monthlyAverage(values: Array<number | null>) {
  return values.length === 0 ? null : sum(values) / values.length;
}

/** Mean of the months that have a value. */
function averageRate(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0 ? null : available.reduce((total, value) => total + value, 0) / available.length;
}

function SectionRow({ title, columns }: { title: string; columns: number }) {
  return (
    <tr className={tableHead}>
      <th colSpan={columns} className={tableCell}>{title}</th>
    </tr>
  );
}

/** One table row; `cells`, `total` and `average` arrive already formatted. */
function SummaryRow({ label, variant, cells, total, average }: {
  label: string;
  variant: RowVariant;
  cells: Array<{ period: string; text: string }>;
  total: string;
  average: string;
}) {
  const isCategory = variant === "category";
  const totalCell = `${tableCell} text-right ${isCategory ? "font-semibold " : ""}tabular-nums`;
  const rowClass = variant === "total" ? "bg-zinc-50 font-semibold" : variant === "bold" ? "font-semibold" : undefined;

  return (
    <tr className={rowClass}>
      <th scope="row" className={`${tableCell} text-left${isCategory ? " font-medium text-black" : ""}`}>
        {label}
      </th>
      {cells.map(({ period, text }) => (
        <td key={period} className={`${tableCell} text-right tabular-nums`}>{text}</td>
      ))}
      <td className={totalCell}>{total}</td>
      <td className={totalCell}>{average}</td>
    </tr>
  );
}

/**
 * One year of monthly income, parent-category expenses, savings and savings rate, with a total and a monthly
 * average. Averages stop at `cutoff` (the end of the previous month); missing months show "—".
 */
export function CashflowSummary({
  report,
  reportingDate,
  cutoff,
  currency,
}: {
  report: CashflowReport;
  reportingDate: string;
  cutoff: string;
  currency: string;
}) {
  const years = [...new Set(report.periods.map((period) => period.period.slice(0, 4)))];
  const [selectedYear, setSelectedYear] = useState(() => years.at(-1) ?? reportingDate.slice(0, 4));
  const periods = useMemo(
    () => periodsInRange(report, `${selectedYear}-01-01`, `${selectedYear}-12-31`),
    [report, selectedYear],
  );
  const averagePeriods = periods.filter((period) => period.period <= cutoff);
  const columns = periods.length + 3;

  const totalIncome = sum(periods.map((period) => period.income));
  const totalExpenses = sum(periods.map((period) => period.expenses));
  const totalSavings = totalIncome - totalExpenses;

  /** A money row whose total and average are derived from the same per-month values as its cells. */
  function moneyRow(label: string, variant: RowVariant, value: (period: CashflowPeriod) => number | null) {
    return (
      <SummaryRow
        key={label}
        label={label}
        variant={variant}
        cells={periods.map((period) => ({ period: period.period, text: formatMoney(value(period)) }))}
        total={formatMoney(sum(periods.map(value)))}
        average={formatMoney(monthlyAverage(averagePeriods.map(value)))}
      />
    );
  }

  return (
    <section aria-label="Cashflow summary">
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-zinc-700">
          Year
          <select
            className="ml-2 border border-zinc-300 bg-white px-2 py-1"
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
          >
            {years.map((year) => <option key={year}>{year}</option>)}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto border border-zinc-300 bg-white">
        <table
          className="w-full table-fixed border-collapse text-xs"
          style={{ minWidth: LABEL_COLUMN_WIDTH + (periods.length + 2) * VALUE_COLUMN_WIDTH }}
        >
          <colgroup>
            <col className="w-52" />
            {periods.map((period) => <col key={period.period} />)}
            <col />
            <col />
          </colgroup>
          <thead className={tableHead}>
            <tr>
              <th className={tableCell}>Cashflow</th>
              {periods.map((period) => (
                <th key={period.period} className={`${tableCell} text-right`}>{formatMonthDash(period.period)}</th>
              ))}
              <th className={`${tableCell} text-right`}>Total</th>
              <th className={`${tableCell} text-right`}>Monthly avg</th>
            </tr>
          </thead>
          <tbody>
            <SectionRow title="Income" columns={columns} />
            {report.incomeCategories.map((category) => moneyRow(category, "category", (period) => period.incomeCategories[category]))}
            {moneyRow("Total income", "total", (period) => period.income)}
          </tbody>
          <tbody>
            <SectionRow title="Expenses" columns={columns} />
            {report.parentCategories.map((category) => moneyRow(category, "category", (period) => period.categories[category]))}
            {moneyRow("Expense (no rent)", "bold", (period) => expensesExcluding(period, ["rent"]))}
            {moneyRow("Expense (no rent and health insurance)", "bold", (period) => expensesExcluding(period, ["rent", "health_insurance"]))}
            {moneyRow("Expenses", "total", (period) => period.expenses)}
          </tbody>
          <tbody>
            <SectionRow title="Savings" columns={columns} />
            <SummaryRow
              label="Savings"
              variant="bold"
              cells={periods.map((period) => ({ period: period.period, text: formatMoney(period.savings) }))}
              total={formatMoney(totalSavings)}
              average={formatMoney(monthlyAverage(averagePeriods.map((period) => period.savings)))}
            />
            <SummaryRow
              label="Savings rate"
              variant="bold"
              cells={periods.map((period) => ({ period: period.period, text: formatPercent(period.savingsRate) }))}
              total={formatPercent(totalIncome === 0 ? null : totalSavings / totalIncome)}
              average={formatPercent(averageRate(averagePeriods.map((period) => period.savingsRate)))}
            />
          </tbody>
        </table>
        {report.unclassifiedExpenses > 0 && (
          <p className="border-t border-zinc-300 px-3 py-2 text-sm text-zinc-600">
            Unclassified expenses: {formatMoney(report.unclassifiedExpenses)} {currency}
          </p>
        )}
      </div>
    </section>
  );
}
