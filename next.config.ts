import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const privateFiles = ["./data/**/*", "./.env*"];

const nextConfig = (phase: string): NextConfig => ({
  reactStrictMode: true,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next-prod",
  // Protect routes and the server; scripts/protect-build.mjs also covers
  // instrumentation, which this Next version skips when applying exclusions.
  outputFileTracingExcludes: {
    "/*": privateFiles,
    "next-server": privateFiles
  }
});

export default nextConfig;
