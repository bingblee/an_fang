import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthGateway } from "@/components/auth-gateway";
import { getCurrentSession, hasOwnerAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "注册 · 安放" };

export default async function RegisterPage() {
  if (await getCurrentSession()) redirect("/");
  if (!hasOwnerAccount()) redirect("/setup");
  return <AuthGateway mode="register" />;
}
