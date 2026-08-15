import { refreshBreezeMultibagger } from "@/features/breeze/api/refresh-breeze-multibagger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return refreshBreezeMultibagger(request);
}
