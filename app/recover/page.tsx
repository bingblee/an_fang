import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthGateway } from "@/components/auth-gateway";
import { getCurrentSession, hasOwnerAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "重置密码 · 安放" };

export default async function RecoverPage() {
  if (await getCurrentSession()) redirect("/account");
  if (!hasOwnerAccount()) redirect("/setup");
  const setupConfigured = Boolean(process.env.AUTH_SETUP_TOKEN && process.env.AUTH_SETUP_TOKEN.length >= 20);
  return <AuthGateway mode="recover" setupConfigured={setupConfigured} />;
}
