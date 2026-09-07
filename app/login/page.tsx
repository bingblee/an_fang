import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthGateway } from "@/components/auth-gateway";
import { getCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "登录 · 安放" };

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentSession()) redirect("/");
  const requested = (await searchParams).next || "/";
  const nextPath = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  return <AuthGateway mode="login" nextPath={nextPath} />;
}
