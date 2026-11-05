import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MacroObservation } from "@/types/market-data";
import { marketDataDirectory } from "./prices";

type MacroFile = {
  series: string;
  downloadedAt: string;
  observations: MacroObservation[];
};

function macroFilePath(series: string) {
  return join(marketDataDirectory(), "macro", `${series}.json`);
}

/** Reads one locally downloaded FRED series. The application never calls FRED at runtime. */
export async function loadMacroSeries(series: string): Promise<MacroObservation[]> {
  let contents: string;
  try {
    contents = await readFile(macroFilePath(series), "utf8");
  } catch {
    throw new Error(`Download macro data for ${series} with npm run download:market-data.`);
  }

  let data: MacroFile;
  try {
    data = JSON.parse(contents) as MacroFile;
  } catch {
    throw new Error(`The local macro-data file for ${series} is invalid.`);
  }
  if (data.series !== series || !Array.isArray(data.observations)) {
    throw new Error(`The local macro-data file for ${series} is invalid.`);
  }
  if (!data.observations.every(({ date, value }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value))) {
    throw new Error(`The local macro-data file for ${series} is invalid.`);
  }
  return data.observations;
}
