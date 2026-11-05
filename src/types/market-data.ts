export type MarketPrice = {
  date: string;
  /** Raw daily close. */
  close: number;
  /** Dividend-adjusted close; null when the provider did not supply one. */
  adjustedClose: number | null;
};

export type MacroObservation = {
  date: string;
  value: number;
};
