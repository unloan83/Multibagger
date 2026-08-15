import type {
  ChargeEstimateRequest,
  OptionChainRow,
  OptionContract,
  OptionsBroker,
  SandboxSpreadOrder,
} from "@/features/options-quant/brokers/types";
import type { OptionLeg } from "@/features/options-quant/lib/types";

const LIVE_API = "https://api.upstox.com";
const SANDBOX_API = "https://api-sandbox.upstox.com";

type JsonRecord = Record<string, unknown>;

export class UpstoxOptionsBroker implements OptionsBroker {
  readonly name = "UPSTOX";

  private liveToken(): string {
    const token = (process.env.UPSTOX_ACCESS_TOKEN || "").trim();
    if (!token) throw new Error("UPSTOX_ACCESS_TOKEN is required for live option-chain market data.");
    return token;
  }

  private sandboxToken(): string {
    const token = (process.env.UPSTOX_SANDBOX_ACCESS_TOKEN || "").trim();
    if (!token) throw new Error("UPSTOX_SANDBOX_ACCESS_TOKEN is required for sandbox orders.");
    return token;
  }

  private async request(url: URL, token: string, init?: RequestInit): Promise<JsonRecord> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as JsonRecord;
    if (!response.ok || payload.status === "error") {
      throw new Error(`Upstox ${response.status}: ${JSON.stringify(payload.errors || payload.message || "request failed")}`);
    }
    return payload;
  }

  async getOptionContracts(underlyingKey: string): Promise<OptionContract[]> {
    const url = new URL("/v2/option/contract", LIVE_API);
    url.searchParams.set("instrument_key", underlyingKey);
    const payload = await this.request(url, this.liveToken());
    const rows = Array.isArray(payload.data) ? payload.data as JsonRecord[] : [];
    return rows.flatMap((row) => {
      const optionType = row.instrument_type;
      if (optionType !== "CE" && optionType !== "PE") return [];
      const contract: OptionContract = {
        expiry: String(row.expiry || ""),
        instrumentKey: String(row.instrument_key || ""),
        tradingSymbol: String(row.trading_symbol || ""),
        optionType,
        strike: Number(row.strike_price),
        lotSize: Number(row.lot_size || row.minimum_lot || 0),
      };
      return contract.instrumentKey && contract.expiry && contract.lotSize > 0 ? [contract] : [];
    });
  }

  async getOptionChain(underlyingKey: string, expiry: string): Promise<OptionChainRow[]> {
    const url = new URL("/v2/option/chain", LIVE_API);
    url.searchParams.set("instrument_key", underlyingKey);
    url.searchParams.set("expiry_date", expiry);
    const payload = await this.request(url, this.liveToken());
    const rows = Array.isArray(payload.data) ? payload.data as JsonRecord[] : [];
    return rows.map((row) => ({
      expiry: String(row.expiry || expiry),
      strike: Number(row.strike_price),
      spot: Number(row.underlying_spot_price),
      call: parseLeg(row.call_options, "CE", Number(row.strike_price)),
      put: parseLeg(row.put_options, "PE", Number(row.strike_price)),
    })).filter((row) => Number.isFinite(row.strike) && row.spot > 0);
  }

  async estimateCharges(requests: ChargeEstimateRequest[]): Promise<number> {
    const totals = await Promise.all(requests.map(async (request) => {
      const url = new URL("/v2/charges/brokerage", LIVE_API);
      url.searchParams.set("instrument_token", request.instrumentKey);
      url.searchParams.set("quantity", String(request.quantity));
      url.searchParams.set("product", "D");
      url.searchParams.set("transaction_type", request.transactionType);
      url.searchParams.set("price", String(request.price));
      const payload = await this.request(url, this.liveToken());
      const data = (payload.data || {}) as JsonRecord;
      const charges = (data.charges || {}) as JsonRecord;
      const total = Number(charges.total);
      if (!Number.isFinite(total)) throw new Error("Upstox charge estimate did not return a finite total.");
      return total;
    }));
    return round(totals.reduce((sum, value) => sum + value, 0));
  }

  async submitSandboxSpread(order: SandboxSpreadOrder): Promise<string[]> {
    return this.submitSandboxOrder(order, false);
  }

  async submitSandboxExit(order: SandboxSpreadOrder): Promise<string[]> {
    return this.submitSandboxOrder(order, true);
  }

  private async submitSandboxOrder(order: SandboxSpreadOrder, closing: boolean): Promise<string[]> {
    if (process.env.UPSTOX_MODE !== "SANDBOX" || process.env.LIVE_TRADING_ENABLED !== "false") {
      throw new Error("Sandbox safety flags are not set; refusing order submission.");
    }
    const url = new URL("/v2/order/multi/place", SANDBOX_API);
    const body = closing
      ? [
          sandboxLeg("buyshort", order.shortInstrumentKey, order.quantity, order.shortLimitPrice, "BUY", order.tag),
          sandboxLeg("selllong", order.longInstrumentKey, order.quantity, order.longLimitPrice, "SELL", order.tag),
        ]
      : [
          sandboxLeg("buylong", order.longInstrumentKey, order.quantity, order.longLimitPrice, "BUY", order.tag),
          sandboxLeg("sellshort", order.shortInstrumentKey, order.quantity, order.shortLimitPrice, "SELL", order.tag),
        ];
    const payload = await this.request(url, this.sandboxToken(), { method: "POST", body: JSON.stringify(body) });
    const rows = Array.isArray(payload.data) ? payload.data as JsonRecord[] : [];
    const ids = rows.map((row) => String(row.order_id || "")).filter(Boolean);
    if (ids.length !== 2) throw new Error("Upstox sandbox did not accept both defined-risk spread legs.");
    return ids;
  }
}

function parseLeg(value: unknown, optionType: "CE" | "PE", strike: number): OptionLeg | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as JsonRecord;
  const market = (raw.market_data || {}) as JsonRecord;
  const greeks = (raw.option_greeks || {}) as JsonRecord;
  const bid = Number(market.bid_price);
  const ask = Number(market.ask_price);
  if (!(bid > 0 && ask > bid)) return null;
  return {
    instrumentKey: String(raw.instrument_key || ""),
    tradingSymbol: String(raw.trading_symbol || `${strike} ${optionType}`),
    side: "BUY",
    optionType,
    strike,
    bid,
    ask,
    ltp: Number(market.ltp || 0),
    iv: Number(greeks.iv || 0),
    delta: Number(greeks.delta || 0),
    oi: Number(market.oi || 0),
    volume: Number(market.volume || 0),
    bidAskSpreadPercent: round(((ask - bid) / ((ask + bid) / 2)) * 100),
  };
}

function sandboxLeg(correlationId: string, instrumentToken: string, quantity: number, price: number, transactionType: "BUY" | "SELL", tag: string) {
  return {
    correlation_id: correlationId,
    quantity,
    product: "D",
    validity: "DAY",
    price,
    tag: tag.slice(0, 40),
    instrument_token: instrumentToken,
    order_type: "LIMIT",
    transaction_type: transactionType,
    disclosed_quantity: 0,
    trigger_price: 0,
    is_amo: false,
    slice: false,
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
