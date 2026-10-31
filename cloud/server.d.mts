import { Server } from "node:http";
export function hashToken(token: string): string;
export function createCloudServer(config: { root: string; tokens: Record<string, string>; origins?: string[]; maxItems?: number; quotaBytes?: number }): Server;
