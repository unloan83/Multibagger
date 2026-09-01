import StrategyLabTab from "@/features/strategy-lab/components/StrategyLabTab";

export const metadata = {
  title: "Strategy Lab — Upstox Algoverse Strategy Intelligence",
  description: "Live interactive strategy selection, approval gate, and execution telemetry.",
};

export default function StrategyLabPage() {
  return (
    <main className="min-h-screen bg-[#060d17] px-3 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="rounded-2xl border border-slate-800 bg-[#091322] p-5 shadow-xl">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Strategy Lab Intelligence</h1>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
                  OCI ENGINE GATE ACTIVE
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
                Interactive strategy approval gate. Automated parameter set ranking dispatches Telegram proposals requiring human confirmation before execution.
              </p>
            </div>
          </div>
        </header>

        <StrategyLabTab />
      </div>
    </main>
  );
}
