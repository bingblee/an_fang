import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthGateway } from "@/components/auth-gateway";
import { getCurrentSession, hasOwnerAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "首次设置 · 安放" };

export default async function SetupPage() {
  if (await getCurrentSession()) redirect("/");
  if (hasOwnerAccount()) redirect("/login");
  const setupConfigured = Boolean(process.env.AUTH_SETUP_TOKEN && process.env.AUTH_SETUP_TOKEN.length >= 20);
  return <AuthGateway mode="setup" setupConfigured={setupConfigured} />;
}
