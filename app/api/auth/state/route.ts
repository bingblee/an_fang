import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  return NextResponse.json(
    {
      authenticated: Boolean(session),
      username: session?.username || null
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
