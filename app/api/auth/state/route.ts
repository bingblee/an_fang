import { NextResponse } from "next/server";
import { getCurrentSession, hasOwnerAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  return NextResponse.json(
    {
      authenticated: Boolean(session),
      needsSetup: !hasOwnerAccount(),
      setupConfigured: Boolean(process.env.AUTH_SETUP_TOKEN && process.env.AUTH_SETUP_TOKEN.length >= 20),
      username: session?.username || null
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
