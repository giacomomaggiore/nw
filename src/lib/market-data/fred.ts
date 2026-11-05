import type { MacroObservation } from "@/types/market-data";

type FredFile = {
  series: string;
  downloadedAt: string;
  observations: MacroObservation[];
};

/** Downloads the public FRED CSV export without requiring an API key. */
export async function downloadFredObservations(series: string): Promise<MacroObservation[]> {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", series);
  const response = await fetch(url, { headers: { "User-Agent": "nw-market-data-downloader/1.0" } });
  if (!response.ok) throw new Error(`FRED did not return data for ${series} (${response.status}).`);

  const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
  const observations = rows.flatMap((row) => {
    const [date, rawValue] = row.split(",");
    const value = Number(rawValue);
    return date && Number.isFinite(value) ? [{ date, value }] : [];
  });
  if (observations.length === 0) throw new Error(`FRED has no observations for ${series}.`);
  return observations;
}

export function fredFileContents(series: string, observations: MacroObservation[]) {
  const data: FredFile = { series, downloadedAt: new Date().toISOString(), observations };
  return `${JSON.stringify(data)}\n`;
}
