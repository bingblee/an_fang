import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/account-panel";
import { getCurrentSession } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账号安全 · 安放" };

export default async function AccountPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/account");
  return <AccountPanel username={session.username} remindersEnabled={getRuntimeConfig().remindersEnabled} />;
}
