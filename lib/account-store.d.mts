import type { DatabaseSync } from "node:sqlite";

export function normalizeUsername(value: string): string;
export function passwordProblem(value: string): string | null;
export function usernameProblem(value: string): string | null;
export function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }>;
export function verifyPassword(password: string, hash: string, salt: string): Promise<boolean>;
export function initialCredentialsPath(dataDir: string): string;
export function readPrivateFile(path: string): string;
export function initializeSystemAccount(db: DatabaseSync, dataDir: string): void;
export function updateAccountPassword(db: DatabaseSync, dataDir: string, userId: string, password: string, expectedHash?: string): Promise<boolean>;
