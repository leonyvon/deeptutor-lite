import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readdir, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface KBConfig {
  rootDir: string;
  defaultKB: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIVE_KB_FILE = join(__dirname, "..", ".active-kb");

async function getActiveKB(defaultKB: string): Promise<string> {
  try {
    const content = await readFile(ACTIVE_KB_FILE, "utf-8");
    return content.trim() || defaultKB;
  } catch {
    return defaultKB;
  }
}

async function setActiveKB(kbName: string): Promise<void> {
  await writeFile(ACTIVE_KB_FILE, kbName, "utf-8");
}

export function registerKBManager(pi: ExtensionAPI, config: KBConfig) {
  // -- kb_list --
  pi.registerTool({
    name: "kb_list",
    label: "List Knowledge Bases",
    description:
      "List all available knowledge bases. Each subdirectory under the KB root is a separate knowledge base.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      try {
        const entries = await readdir(config.rootDir, { withFileTypes: true });
        const kbs = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => ({ name: e.name, path: join(config.rootDir, e.name) }));

        const activeKB = await getActiveKB(config.defaultKB);

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
  });

  // -- kb_switch --
  pi.registerTool({
    name: "kb_switch",
    label: "Switch Knowledge Base",
    description:
      "Switch the active knowledge base. All subsequent knowledge_search queries will use this KB.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Name of the knowledge base to switch to" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
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

      await setActiveKB(params.kb_name);
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
  });

  // -- kb_create --
  pi.registerTool({
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
      const kbPath = join(config.rootDir, params.kb_name);

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
      await setActiveKB(params.kb_name);

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
  });
}
