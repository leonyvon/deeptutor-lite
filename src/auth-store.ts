/**
 * File-backed CredentialStore (pi's auth.json pattern).
 *
 * Mirrors ~/.pi/agent/auth.json: one credential per provider id.
 *   { "opencode-go": { "type": "api_key", "key": "sk-..." } }
 *
 * Stored at ~/.deeptutor/auth.json (DEEPTUTOR_HOME overridable).
 * read/modify/delete are the pi-ai CredentialStore contract consumed by
 * createModels({ credentials }), so envApiKeyAuth resolves stored keys
 * before falling back to environment variables.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { dataHome } from "./config.js";

/** Absolute path of the auth file. */
export function authPath(): string {
  return join(dataHome(), "auth.json");
}

/** Minimal JSON file credential store (serialized read-modify-write). */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly file: string = authPath()) {}

  private readAll(): Record<string, Credential> {
    try {
      return JSON.parse(readFileSync(this.file, "utf-8"));
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, Credential>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(all, null, 2), { encoding: "utf-8", mode: 0o600 });
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.readAll()[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.readAll()).map(([providerId, c]) => ({
      providerId,
      type: c.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    const all = this.readAll();
    const next = await fn(all[providerId]);
    if (next) all[providerId] = next;
    else delete all[providerId];
    this.writeAll(all);
    return next;
  }

  async delete(providerId: string): Promise<void> {
    const all = this.readAll();
    delete all[providerId];
    this.writeAll(all);
  }
}
