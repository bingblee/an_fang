import { AppShell } from "@/components/app-shell";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";

export const dynamic = "force-dynamic";

export default function Home() {
  const { environment, remindersEnabled } = getRuntimeConfig();
  return <AppShell environment={environment} remindersEnabled={remindersEnabled} />;
}
