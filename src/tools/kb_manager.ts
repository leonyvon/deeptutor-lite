import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { readdir, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { ToolContext, Config } from "../types.ts";

/**
 * Generic identity wrapper so each tool's `execute` `params` is inferred from
 * its `parameters` schema (mirrors the generic registerTool of the old pi
 * extension). Keeps the exported factory return type as
 * `AgentHarnessTool<ToolContext>`.
 */
function tool<TParams extends TSchema, TDetails = unknown>(
  t: AgentHarnessTool<ToolContext, TParams, TDetails>
): AgentHarnessTool<ToolContext, TParams, TDetails> {
  return t;
}

async function getActiveKB(rootDir: string, defaultKB: string): Promise<string> {
  try {
    const content = await readFile(join(rootDir, ".active-kb"), "utf-8");
    return content.trim() || defaultKB;
  } catch {
    return defaultKB;
  }
}

async function setActiveKB(rootDir: string, kbName: string): Promise<void> {
  await writeFile(join(rootDir, ".active-kb"), kbName, "utf-8");
}

export function createKBManagerTools(cfg: Config["kb"]): AgentHarnessTool<ToolContext>[] {
  const rootDir = cfg.rootDir;
  return [
    // -- kb_list --
    tool({
      name: "kb_list",
      label: "List Knowledge Bases",
      description:
        "List all available knowledge bases. Each subdirectory under the KB root is a separate knowledge base.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        try {
          const entries = await readdir(cfg.rootDir, { withFileTypes: true });
          const kbs = entries
            .filter((e) => e.isDirectory() && !e.name.startsWith("."))
            .map((e) => ({ name: e.name, path: join(cfg.rootDir, e.name) }));

          const activeKB = await getActiveKB(rootDir, cfg.defaultKB);

          const result = kbs.map((kb) => ({
            ...kb,
            active: kb.name === activeKB,
          }));

          return {
            content: [{ type: "text", text: JSON.stringify({ kbs: result }, null, 2) }],
            details: { kbCount: result.length },
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Failed to list KBs: ${err.message}` }],
            details: {},
          };
        }
      },
    }),

    // -- kb_switch --
    tool({
      name: "kb_switch",
      label: "Switch Knowledge Base",
      description:
        "Switch the active knowledge base. All subsequent knowledge_search queries will use this KB.",
      parameters: Type.Object({
        kb_name: Type.String({ description: "Name of the knowledge base to switch to" }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const kbPath = join(cfg.rootDir, params.kb_name);
        try {
          await access(kbPath);
        } catch {
          return {
            content: [
              {
                type: "text",
                text: `Knowledge base "${params.kb_name}" does not exist. Use kb_list to see available KBs, or kb_create to create it.`,
              },
            ],
            details: { success: false },
          };
        }

        await setActiveKB(rootDir, params.kb_name);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: true, activeKB: params.kb_name, path: kbPath },
                null,
                2
              ),
            },
          ],
          details: { success: true, activeKB: params.kb_name },
        };
      },
    }),

    // -- kb_create --
    tool({
      name: "kb_create",
      label: "Create Knowledge Base",
      description:
        "Create a new knowledge base directory. Use knowledge_add to populate it with documents.",
      parameters: Type.Object({
        kb_name: Type.String({ description: "Name for the new knowledge base" }),
        description: Type.Optional(
          Type.String({ description: "Optional description of the knowledge base" })
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const kbPath = join(cfg.rootDir, params.kb_name);

        try {
          await access(kbPath);
          return {
            content: [
              {
                type: "text",
                text: `Knowledge base "${params.kb_name}" already exists at ${kbPath}`,
              },
            ],
            details: { success: false, reason: "already exists" },
          };
        } catch {
          // Directory does not exist — proceed
        }

        await mkdir(kbPath, { recursive: true });

        if (params.description) {
          const descFile = join(kbPath, ".kb-description");
          await writeFile(descFile, params.description, "utf-8");
        }

        // Make the new KB active
        await setActiveKB(rootDir, params.kb_name);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  kb_name: params.kb_name,
                  path: kbPath,
                  description: params.description ?? "",
                  active: true,
                },
                null,
                2
              ),
            },
          ],
          details: { success: true, path: kbPath },
        };
      },
    }),
  ];
}
