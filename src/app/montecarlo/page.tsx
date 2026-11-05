import { connection } from "next/server";
import { MonteCarloDashboard } from "@/components/montecarlo/monte-carlo-dashboard";
import { resolveMultiplier } from "@/lib/auth/access";
import { defaultMonteCarloSources, loadMonteCarloPage } from "./load-montecarlo-page";

export const metadata = { title: "Monte Carlo" };
export const instant = false;

export default async function MonteCarloPage() {
  await connection();
  const { inputs, error } = await loadMonteCarloPage(defaultMonteCarloSources, resolveMultiplier);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <MonteCarloDashboard simulation={inputs} error={error ?? undefined} />
    </main>
  );
}
