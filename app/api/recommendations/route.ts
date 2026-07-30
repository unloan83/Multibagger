import { NextResponse } from "next/server";
import { readWealthRecommendationsSnapshot } from "@/lib/expert-insights";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await readWealthRecommendationsSnapshot();
    if (snapshot) {
      return NextResponse.json(snapshot);
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), categories: [] },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: false, error: "No recommendation snapshot found.", categories: [] },
    { status: 404 },
  );
}
