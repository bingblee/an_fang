import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const { environment, remindersEnabled } = getRuntimeConfig();
  return <AppShell environment={environment} remindersEnabled={remindersEnabled} username={session.username} />;
}
