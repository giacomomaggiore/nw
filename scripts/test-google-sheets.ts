// Read-only check of the live workbook against the contract in CLAUDE.md. Run with `npm run test:sheets`.
import { loadEnvConfig } from "@next/env";
import { parseCashflowWorkbook } from "@/lib/sheets/cashflow";
import { readSheetValues } from "@/lib/sheets/client";
import { parseNetWorthWorkbook } from "@/lib/sheets/net-worth";
import { checkWorkbook, type TabCheck } from "@/lib/sheets/validate";

loadEnvConfig(process.cwd());

for (const variable of ["GOOGLE_SHEET_ID", "GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY"]) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

async function main() {
  const [cashflow, assets, constants, saa, categories, metadata] = await readSheetValues(
    "cashflow!A:H",
    "assets!A:Z",
    "constants!A:B",
    "saa!A:Z",
    "categories!A:D",
    "metadata!A:G",
  );
  const checks: TabCheck[] = checkWorkbook({ cashflow, assets, constants, saa, categories, metadata });

  // The app's own parsers must accept the workbook too, so this check cannot pass while the pages fail.
  try {
    parseCashflowWorkbook({ cashflowRows: cashflow, categoryRows: categories, constantRows: constants });
    parseNetWorthWorkbook({ assetRows: assets, metadataRows: metadata, constantRows: constants });
  } catch (error) {
    checks.push({ tab: "app parsers", summary: "", errors: [error instanceof Error ? error.message : String(error)] });
  }

  for (const { tab, summary, errors } of checks) {
    console.log(errors.length === 0 ? `ok    ${tab}: ${summary}` : `FAIL  ${tab}: ${summary}\n${errors.map((error) => `        ${error}`).join("\n")}`);
  }
  if (checks.some(({ errors }) => errors.length > 0)) {
    throw new Error("Workbook validation failed.");
  }
  console.log("Workbook schemas and values are valid.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
