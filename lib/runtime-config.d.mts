export type AppEnvironment = "development" | "production" | "test";
export interface RuntimeConfig {
  environment: AppEnvironment;
  dataRoot: string;
  directories: Record<AppEnvironment, string>;
  dataDir: string;
  databasePath: string;
  remindersEnabled: boolean;
}
export function getRuntimeConfig(env?: NodeJS.ProcessEnv, cwd?: string): RuntimeConfig;
export function ensureDataDirectory(config: RuntimeConfig, options?: { allowLegacyMigration?: boolean }): void;
