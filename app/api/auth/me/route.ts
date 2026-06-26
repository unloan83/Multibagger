import { NextResponse } from "next/server";
import { getCurrentSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    user: {
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      portfolioName: user.portfolioName,
    },
  });
}

export async function PATCH() {
  return NextResponse.json(
    { error: "Profile editing is managed by LiveUnloan." },
    { status: 410 },
  );
}
