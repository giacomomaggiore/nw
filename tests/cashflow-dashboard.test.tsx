import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CashflowDashboard } from "@/components/cashflow/cashflow-dashboard";
import { buildCashflowReport, type CashflowReport } from "@/lib/analytics/cashflow";

const categories = [
  { category: "salary", parentCategory: "income", isEssential: false, isRecurring: true },
  { category: "rent", parentCategory: "housing", isEssential: true, isRecurring: true },
  { category: "dining", parentCategory: "food", isEssential: false, isRecurring: false },
  { category: "food.delivery", parentCategory: "food.delivery", isEssential: false, isRecurring: true },
];
const report = buildCashflowReport([
  { date: "2026-01-10", type: "income", amount: 3000, category: "salary" },
  { date: "2026-01-15", type: "expense", amount: 1000, category: "rent" },
  { date: "2026-02-10", type: "expense", amount: 100, category: "dining" },
  { date: "2026-02-12", type: "expense", amount: 25, category: "food.delivery" },
  { date: "2026-02-14", type: "expense", amount: 40, category: null },
], categories);

function renderReport(source: CashflowReport, reportingDate = "2026-10-15") {
  return renderToStaticMarkup(<CashflowDashboard reports={{ EUR: source }} currency="EUR" reportingDate={reportingDate} />);
}

describe("CashflowDashboard", () => {
  const html = renderReport(report);

  it("renders the filters, the summary table and the year selector", () => {
    assert.match(html, /aria-label="Report filters"/);
    assert.match(html, /aria-label="Cashflow summary"/);
    assert.match(html, /Year<select[^>]*><option selected="">2026<\/option><\/select>/);
    assert.equal((html.match(/type="date"/g) ?? []).length, 2);
    for (const label of ["All time", "YTD", "Current year", "Last year"]) assert.match(html, new RegExp(`>${label}<`));
  });

  it("shows every month of the report year in the summary header", () => {
    for (const month of ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Oct", "Nov", "Dec"]) {
      assert.match(html, new RegExp(`${month}-26`));
    }
    assert.match(html, /Sep(t)?-26/, "ICU versions differ on Sep / Sept");
  });

  it("always shows twelve month columns in the summary, however little data the report has", () => {
    const single = buildCashflowReport([{ date: "2026-03-10", type: "income", amount: 100, category: "salary" }], categories);
    for (const source of [report, single, buildCashflowReport([], [])]) {
      const summary = renderReport(source).match(/<table[\s\S]*?<\/table>/)![0];
      const header = summary.match(/<thead[\s\S]*?<\/thead>/)![0];
      assert.equal((header.match(/<th[^>]*>[A-Z][a-z]{2,3}-26<\/th>/g) ?? []).length, 12);
    }
  });

  it("shows totals, parent-category rows and the unclassified-expense note", () => {
    assert.match(html, />1,165</, "the table's expense total includes the unclassified 40");
    assert.match(html, /1,125 EUR/, "the insight tile counts categorised expenses only");
    assert.match(html, /Unclassified expenses: 40 EUR/);
    assert.match(html, /1,000 EUR/);
    assert.match(html, /food\.delivery/);
  });

  it("excludes rent and health insurance from the monthly values, total and average", () => {
    const source = buildCashflowReport([
      { date: "2026-01-01", type: "expense", amount: 1000, category: "RENT" },
      { date: "2026-01-02", type: "expense", amount: 300, category: "HEALTH_INSURANCE" },
      { date: "2026-01-03", type: "expense", amount: 200, category: "DOCTOR" },
      { date: "2026-01-04", type: "expense", amount: 40, category: null },
      { date: "2026-02-01", type: "expense", amount: 100, category: "HEALTH_INSURANCE" },
      { date: "2026-02-02", type: "expense", amount: 60, category: "DOCTOR" },
    ], [
      { category: "RENT", parentCategory: "HOUSING", isEssential: true, isRecurring: true },
      { category: "HEALTH_INSURANCE", parentCategory: "HEALTH", isEssential: true, isRecurring: true },
      { category: "DOCTOR", parentCategory: "HEALTH", isEssential: true, isRecurring: false },
    ]);
    const row = renderReport(source, "2026-03-15").match(/<tr[^>]*><th[^>]*>Expense \(no rent and health insurance\)<\/th>[\s\S]*?<\/tr>/)![0];
    const values = [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((match) => match[1]);
    assert.deepEqual(values, ["240", "60", ...Array(10).fill("—"), "300", "150"]);
  });

  it("renders the two tables and eight charts", () => {
    assert.equal((html.match(/<table\b/g) ?? []).length, 2);
    assert.equal((html.match(/class="recharts-responsive-container"/g) ?? []).length, 8);
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
    assert.match(html, /<span class="sr-only">Expense insights<\/span>/);
  });

  it("links every aria-labelledby to an existing id, and ids are unique", () => {
    for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
      for (const id of match[1].split(" ")) assert.ok(html.includes(`id="${id}"`), `Missing label target: ${id}`);
    }
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("renders deterministically", () => {
    assert.equal(renderReport(report), html);
  });

  it("never prints NaN or Infinity, even for an empty report or at year boundaries", () => {
    for (const source of [report, buildCashflowReport([], [])]) {
      for (const date of ["2026-01-15", "2026-10-15"]) {
        const result = renderReport(source, date);
        assert.doesNotMatch(result, /NaN|Infinity/);
        assert.ok(result.includes(`max="${date.slice(0, 4)}-12-31" value=""`));
      }
    }
  });

  it("describes the moving-average chart", () => {
    assert.match(renderReport(report, "2026-03-15"), /Moving average expenses by parent category/);
  });
});
