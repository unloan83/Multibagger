import { NextResponse } from "next/server";
import type { PortfolioInputRow } from "@/lib/portfolio";
import { normalizeQuoteRows, resolveQuotePositions } from "@/lib/quote-service";

export const dynamic = "force-dynamic";

type QuoteRequest = {
  rows?: Array<Partial<PortfolioInputRow>>;
};

export async function POST(request: Request) {
  const body = (await request.json()) as QuoteRequest;
  const rows = normalizeQuoteRows(body.rows ?? []);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid stocks found in the uploaded CSV." },
      { status: 400 },
    );
  }

  const positions = await resolveQuotePositions(rows);
  const unresolved = positions.filter((position) => !position.currentPrice);

  return NextResponse.json({
    positions,
    unresolved: unresolved.map((position) => position.stock),
    refreshedAt: new Date().toISOString(),
  });
}
