import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { ProxyAgent, fetch } from "undici";
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

export function createWebSearchTool(cfg: Config["search"]): AgentHarnessTool<ToolContext> {
  return tool({
    name: "web_search",
    label: "Web Search (Brave)",
    description:
      "Search the web using Brave Search API. Use for real-time information, recent events, news, or topics not covered in the knowledge base. Returns title, URL, and snippet for each result.",
    parameters: Type.Object({
      query: Type.String({
        description: "The search query string",
      }),
      max_results: Type.Optional(
        Type.Number({
          default: cfg.maxResults,
          description: "Maximum number of results to return (1-10)",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const maxResults = Math.max(1, Math.min(params.max_results ?? cfg.maxResults, 10));

      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", params.query);
      url.searchParams.set("count", String(maxResults));

      const dispatcher = cfg.proxy
        ? new ProxyAgent(cfg.proxy)
        : undefined;

      const fetchOptions: Record<string, unknown> = {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": cfg.apiKey,
        },
      };

      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      const resp = await fetch(url, fetchOptions);

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Brave API error: ${resp.status} - ${body.slice(0, 500)}`);
      }

      const payload: any = await resp.json();
      const rows = payload.web?.results ?? [];

      const results = rows.map((row: any) => ({
        title: row.title ?? "",
        url: row.url ?? "",
        snippet: row.description ?? "",
        source: "Brave",
        date: row.age ?? "",
      }));

      const responseBody = {
        provider: "brave",
        results,
        count: results.length,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseBody, null, 2),
          },
        ],
        details: { provider: "brave", resultCount: results.length },
      };
    },
  });
}
