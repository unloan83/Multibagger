import type { OptionLeg } from "@/features/options-quant/lib/types";

export type OptionContract = {
  expiry: string;
  instrumentKey: string;
  tradingSymbol: string;
  optionType: "CE" | "PE";
  strike: number;
  lotSize: number;
};

export type OptionChainRow = {
  expiry: string;
  strike: number;
  spot: number;
  call: OptionLeg | null;
  put: OptionLeg | null;
};

export type ChargeEstimateRequest = {
  instrumentKey: string;
  quantity: number;
  transactionType: "BUY" | "SELL";
  price: number;
};

export type SandboxSpreadOrder = {
  quantity: number;
  longInstrumentKey: string;
  shortInstrumentKey: string;
  longLimitPrice: number;
  shortLimitPrice: number;
  tag: string;
};

export interface OptionsBroker {
  readonly name: string;
  getOptionContracts(underlyingKey: string): Promise<OptionContract[]>;
  getOptionChain(underlyingKey: string, expiry: string): Promise<OptionChainRow[]>;
  estimateCharges(requests: ChargeEstimateRequest[]): Promise<number>;
  submitSandboxSpread(order: SandboxSpreadOrder): Promise<string[]>;
  submitSandboxExit(order: SandboxSpreadOrder): Promise<string[]>;
}
