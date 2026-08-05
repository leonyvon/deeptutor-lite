import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolContext, Config } from "../types.ts";

/**
 * Generic identity wrapper so the tool's `execute` `params` is inferred from
 * its `parameters` schema (mirrors the generic registerTool of the old pi
 * extension). Keeps the exported factory return type as
 * `AgentHarnessTool<ToolContext>`.
 */
function tool<TParams extends TSchema, TDetails = unknown>(
  t: AgentHarnessTool<ToolContext, TParams, TDetails>
): AgentHarnessTool<ToolContext, TParams, TDetails> {
  return t;
}

export function createPythonRunnerTool(
  cfg: Config["python"],
  kb: Config["kb"]
): AgentHarnessTool<ToolContext> {
  return tool({
    name: "python_run",
    label: "Run Python Code",
    description:
      "Execute Python code in a temporary file within the active KB directory. Capture stdout, stderr, and exit code. Maximum timeout is configurable (default 30s, max 300s). NOT a sandbox — code runs with the user's permissions.",
    parameters: Type.Object({
      code: Type.String({ description: "Python source code to execute" }),
      timeout: Type.Optional(
        Type.Number({
          default: cfg.timeout,
          description: `Timeout in seconds (max ${cfg.maxTimeout})`,
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const timeoutSec = Math.min(
        params.timeout ?? cfg.timeout,
        cfg.maxTimeout
      );
      const tmpFile = join(
        process.env.TMPDIR ?? process.env.TEMP ?? "/tmp",
        `dt-py-${randomUUID()}.py`
      );

      try {
        await writeFile(tmpFile, params.code, "utf-8");

        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
          (resolve, reject) => {
            const proc = spawn("python", [tmpFile], {
              cwd: kb.rootDir,
              timeout: timeoutSec * 1000,
              windowsHide: true,
            });

            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (d: Buffer) => {
              stdout += d.toString();
              if (stdout.length > 100_000) stdout = stdout.slice(-80_000);
            });

            proc.stderr.on("data", (d: Buffer) => {
              stderr += d.toString();
              if (stderr.length > 100_000) stderr = stderr.slice(-80_000);
            });

            proc.on("close", (code) => {
              resolve({ stdout: stdout.slice(0, 50_000), stderr: stderr.slice(0, 50_000), exitCode: code ?? -1 });
            });

            proc.on("error", (err) => {
              reject(new Error(`Failed to spawn Python: ${err.message}`));
            });
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  exitCode: result.exitCode,
                  stdout: result.stdout || "(no output)",
                  stderr: result.stderr || "(no errors)",
                },
                null,
                2
              ),
            },
          ],
          details: { exitCode: result.exitCode },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { exitCode: -1, stdout: "", stderr: `Execution error: ${err.message}` },
                null,
                2
              ),
            },
          ],
          details: { exitCode: -1, error: err.message },
        };
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    },
  });
}
