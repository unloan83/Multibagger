import { getBreezeMultibagger } from "@/features/breeze/api/breeze-multibagger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return getBreezeMultibagger();
}
