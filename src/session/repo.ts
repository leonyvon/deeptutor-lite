/**
 * JSONL session repository for the deeptutor app.
 *
 * Uses core's `JsonlSessionRepo` with the core-provided Node execution
 * environment (`NodeExecutionEnv` from `@earendil-works/pi-agent-core/node`)
 * as the `FileSystem` backend — no custom fs adapter needed.
 */
import { JsonlSessionRepo, NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { mkdirSync } from "node:fs";

/**
 * Create a JSONL session repository rooted at `sessionsDir`.
 *
 * The directory is created recursively (mkdir -p) when missing. Session files
 * are persisted as `sessionsDir/<encoded-cwd>/<timestamp>_<id>.jsonl` by
 * `JsonlSessionRepo`.
 */
export function createSessionRepo(sessionsDir: string): JsonlSessionRepo {
  mkdirSync(sessionsDir, { recursive: true });
  return new JsonlSessionRepo({
    fs: new NodeExecutionEnv({ cwd: process.cwd() }),
    sessionsRoot: sessionsDir,
  });
}
