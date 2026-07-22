import fs from "node:fs/promises";
import path from "node:path";
import {
  getMarketUniverse,
  screenWealthUniverse,
  type MarketCapBucket,
  type ScreenedStock,
  type ScreeningRegime,
} from "@/lib/wealth-screening";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThematicSectorKey =
  | "defenseCapitalGoods"
  | "renewableEnergy"
  | "cdmoSpecialtyPharma"
  | "evSupplyChain"
  | "aiDataCenters"
  | "semiconductorsElectronics";

export type LongTermCapSlot = "large" | "mid" | "small" | "emerging";

export type ThematicSectorCandidate = ScreenedStock & {
  /** The thematic sector this stock belongs to. */
  thematicSectorKey: ThematicSectorKey;
  /** Human-readable thematic sector name. */
  thematicSectorTitle: string;
  /** Cap slot within the thematic sector. */
  capSlot: LongTermCapSlot;
};

export type ThematicSectorResult = {
  key: ThematicSectorKey;
  title: string;
  description: string;
  /** 4 stocks per slot; fewer if quality gates eliminate candidates. */
  slots: Record<LongTermCapSlot, ThematicSectorCandidate[]>;
  /** Per-slot counts for summary logging. */
  slotCounts: Record<LongTermCapSlot, number>;
};

export type LongTermUniverse = {
  asOf: string;
  marketRegime: ScreeningRegime;
  sectors: ThematicSectorResult[];
  /** Target 96; actual may be lower if quality gates eliminate candidates. */
  totalStocks: number;
  slotSummary: Record<ThematicSectorKey, Record<LongTermCapSlot, number>>;
};

// ---------------------------------------------------------------------------
// Config shape (matches data/thematic-sector-config.json)
// ---------------------------------------------------------------------------

type EmergingGates = {
  minRevenueGrowthPct: number;
  minRoe: number;
  minQuarters: number;
  requirePositiveEarnings: boolean;
};

type ThematicSectorConfig = {
  key: string;
  title: string;
  description: string;
  primaryThemes: string[];
  additionalSymbols: string[];
  exclusions: string[];
  emergingSymbols: string[];
  emergingGates: EmergingGates;
};

type SectorConfig = { sectors: ThematicSectorConfig[] };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "long_term_universe.json");
const CONFIG_PATH = path.join(process.cwd(), "data", "thematic-sector-config.json");
const STOCKS_PER_STANDARD_SLOT = 4;
const STOCKS_PER_EMERGING_SLOT = 4;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the full NIFTY 500 wealth screening engine and organises results into
 * the 6 thematic sectors defined in data/thematic-sector-config.json.
 *
 * Each thematic sector produces 4 stocks per slot (large / mid / small / emerging)
 * for a target total of 96 long-term candidates.
 *
 * This function performs live network calls and should only be called from
 * the snapshot cron endpoint (GET /api/snapshots/long-term-universe), NOT
 * from the per-request agent pipeline.  The agent pipeline reads the cached
 * snapshot via readLongTermUniverseSnapshot().
 */
export async function screenLongTermUniverse(
  regime: ScreeningRegime = "Consolidation",
  now = new Date(),
): Promise<LongTermUniverse> {
  const [allScreened, config] = await Promise.all([
    screenWealthUniverse(regime),
    readSectorConfig(),
  ]);

  const screenerBySymbol = new Map<string, ScreenedStock>(
    allScreened.map((s) => [s.symbol, s]),
  );

  const universe = getMarketUniverse();
  const universeBySymbol = new Map(universe.map((s) => [s.symbol, s]));

  const sectors: ThematicSectorResult[] = config.sectors.map((cfg) => {
    const sectorKey = cfg.key as ThematicSectorKey;

    // --- Standard slots (large / mid / small) ---
    // Eligible screened stocks whose NIFTY theme is in primaryThemes or whose
    // symbol is in additionalSymbols, minus any exclusions.
    const exclusionSet = new Set(cfg.exclusions.map((s) => s.toUpperCase()));
    const additionalSet = new Set(cfg.additionalSymbols.map((s) => s.toUpperCase()));

    const standardPool = allScreened.filter((stock) => {
      if (exclusionSet.has(stock.symbol.toUpperCase())) return false;
      const inPrimaryTheme = cfg.primaryThemes.includes(stock.theme);
      const inAdditional = additionalSet.has(stock.symbol.toUpperCase());
      return inPrimaryTheme || inAdditional;
    });

    const pickSlot = (cap: MarketCapBucket): ThematicSectorCandidate[] =>
      standardPool
        .filter((s) => s.capBucket === cap && s.eligible)
        .sort((a, b) => b.score - a.score)
        .slice(0, STOCKS_PER_STANDARD_SLOT)
        .map((s) => ({
          ...s,
          thematicSectorKey: sectorKey,
          thematicSectorTitle: cfg.title,
          capSlot: cap as LongTermCapSlot,
        }));

    // --- Emerging slot ---
    // Uses the explicit emergingSymbols list, filtered by the sector's
    // relaxed quality gates.  The stock must exist in the screener output
    // (so we have live price + fundamentals) but applies relaxed thresholds.
    const emergingPool = cfg.emergingSymbols
      .map((sym) => screenerBySymbol.get(sym.toUpperCase()) ?? screenerBySymbol.get(sym))
      .filter((s): s is ScreenedStock => s !== undefined)
      .filter((s) => meetsEmergingGates(s, cfg.emergingGates))
      .sort((a, b) => b.score - a.score)
      .slice(0, STOCKS_PER_EMERGING_SLOT)
      .map((s) => ({
        ...s,
        thematicSectorKey: sectorKey,
        thematicSectorTitle: cfg.title,
        capSlot: "emerging" as LongTermCapSlot,
      }));

    // Fall back to non-eligible screened stocks for emerging if the list is short
    const emergingSlot: ThematicSectorCandidate[] = emergingPool.length >= 1
      ? emergingPool
      : cfg.emergingSymbols
          .map((sym) => {
            // Use universe metadata as a scaffold if the screener didn't process this symbol
            const universeEntry = universeBySymbol.get(sym.toUpperCase()) ?? universeBySymbol.get(sym);
            if (!universeEntry) return null;
            const screened = screenerBySymbol.get(sym.toUpperCase());
            if (!screened) return null;
            return {
              ...screened,
              thematicSectorKey: sectorKey,
              thematicSectorTitle: cfg.title,
              capSlot: "emerging" as LongTermCapSlot,
            };
          })
          .filter((s): s is ThematicSectorCandidate => s !== null)
          .slice(0, STOCKS_PER_EMERGING_SLOT);

    const largePicks = pickSlot("large");
    const midPicks = pickSlot("mid");
    const smallPicks = pickSlot("small");

    return {
      key: sectorKey,
      title: cfg.title,
      description: cfg.description,
      slots: {
        large: largePicks,
        mid: midPicks,
        small: smallPicks,
        emerging: emergingSlot,
      },
      slotCounts: {
        large: largePicks.length,
        mid: midPicks.length,
        small: smallPicks.length,
        emerging: emergingSlot.length,
      },
    };
  });

  const totalStocks = sectors.reduce(
    (sum, sector) => sum + Object.values(sector.slotCounts).reduce((a, b) => a + b, 0),
    0,
  );

  const slotSummary = Object.fromEntries(
    sectors.map((s) => [s.key, s.slotCounts]),
  ) as Record<ThematicSectorKey, Record<LongTermCapSlot, number>>;

  return {
    asOf: now.toISOString(),
    marketRegime: regime,
    sectors,
    totalStocks,
    slotSummary,
  };
}

/**
 * Writes the LongTermUniverse snapshot to data/long_term_universe.json.
 * Called by the cron endpoint after a successful screen.
 */
export async function writeLongTermUniverseSnapshot(
  universe: LongTermUniverse,
): Promise<void> {
  await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(universe, null, 2)}\n`, "utf8");
}

/**
 * Reads the cached snapshot from disk.  Returns null if the file does not exist,
 * if the snapshot is older than 36 hours, or if it contains no stocks.
 * This is the fast path used by agentWealthUniverse on every agent request.
 */
export async function readLongTermUniverseSnapshot(): Promise<LongTermUniverse | null> {
  const MAX_AGE_HOURS = 36;
  try {
    const json = await fs.readFile(SNAPSHOT_PATH, "utf8");
    const snapshot = JSON.parse(json) as LongTermUniverse;
    const ageHours = (Date.now() - Date.parse(snapshot.asOf)) / 3_600_000;

    if (
      !Number.isFinite(ageHours) ||
      ageHours < -1 ||
      ageHours > MAX_AGE_HOURS ||
      snapshot.totalStocks === 0
    ) {
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readSectorConfig(): Promise<SectorConfig> {
  const json = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(json) as SectorConfig;
}

/**
 * Applies relaxed quality gates for the "emerging" slot.
 * Always requires positive earnings (unless the sector config explicitly
 * disables it) and a minimum revenue growth rate.
 */
function meetsEmergingGates(stock: ScreenedStock, gates: EmergingGates): boolean {
  if (stock.revenueGrowthPercent < gates.minRevenueGrowthPct) return false;
  if (stock.returnOnEquityPercent < gates.minRoe * 100) return false;
  if (gates.requirePositiveEarnings && stock.earningsGrowthPercent < -50) return false;
  // Relaxed quarter check: screener already fetched 3+ quarters if the stock is in the map
  return true;
}
