import { NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ publicKey: getVapidKeys().publicKey });
}

