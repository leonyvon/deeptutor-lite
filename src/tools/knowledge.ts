/**
 * RAG tool adapters for the deeptutor standalone app.
 *
 * Ports the 12 `knowledge_*` tools from the pi-knowledge extension's
 * registration layer (its top-level index.ts) onto the vendored
 * {@link KnowledgeEngine} in `src/rag/`. Each tool keeps the original
 * description (the agent-facing contract) and result shape
 * `{ content: [{ type: "text", text }], details }`.
 */
import { isAbsolute, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { Config, ToolContext } from "../types.ts";
import { KnowledgeEngine } from "../rag/index.js";
import type { AddOptions, DoctorReport, SearchMode, SearchResponse, SymbolSearchResponse } from "../rag/index.js";

/**
 * Create the RAG tools for an agent harness.
 *
 * @param cfg Knowledge-base config (rootDir is the base for relative source
 *            paths, indexDir is where the RAG index lives).
 * @param embedding Model config (embeddingModel is used as the embedding
 *            model against the OpenAI-compatible embeddingBaseUrl).
 */
export function createKnowledgeTools(
	cfg: Config["kb"],
	embedding: Config["model"],
): AgentHarnessTool<ToolContext>[] {
	let enginePromise: Promise<KnowledgeEngine> | undefined;

	/** Lazily construct + initialize the shared engine (one per app instance). */
	function ensureEngine(): Promise<KnowledgeEngine> {
		enginePromise ??= (async () => {
			const engine = new KnowledgeEngine({
				dataDir: cfg.indexDir,
				embedding: {
					provider: embedding.embeddingModel ? `openai:${embedding.embeddingModel}` : "openai",
					baseUrl: embedding.embeddingBaseUrl,
					apiKey: embedding.apiKey ?? "",
					fallback: "",
				},
			});
			await engine.initialize();
			return engine;
		})();
		return enginePromise;
	}

	/** Resolve relative source paths against the KB root dir. */
	function resolveSource(source: string): string {
		if (/^https?:\/\//.test(source)) return source;
		if (isAbsolute(source)) return source;
		return resolve(cfg.rootDir, source);
	}

	const toAddOptions = (raw: {
		include_suggested_text?: boolean;
		include_paths?: unknown;
		exclude_paths?: unknown;
	}): AddOptions => ({
		include_suggested_text: raw.include_suggested_text === true,
		include_paths: Array.isArray(raw.include_paths)
			? raw.include_paths.filter((item): item is string => typeof item === "string")
			: undefined,
		exclude_paths: Array.isArray(raw.exclude_paths)
			? raw.exclude_paths.filter((item): item is string => typeof item === "string")
			: undefined,
	});

	return [
		{
			name: "knowledge_plan",
			label: "Knowledge Plan",
			description:
				"Inspect an indexing source without writing a KB, showing scannable counts, suggested exclusions, and technical skips",
			parameters: Type.Object({
				source: Type.String({
					description: "File path, directory path, URL, or inline text to inspect before indexing",
				}),
				include_suggested_text: Type.Optional(
					Type.Boolean({
						description:
							"Preview the scope if suggested-excluded text such as vendor/build/runtime/cache/secret-named text is included",
					}),
				),
				include_paths: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Relative paths under a directory source to include even when they match suggested-exclude patterns",
						}),
						{ description: "Relative paths to include" },
					),
				),
				exclude_paths: Type.Optional(
					Type.Array(
						Type.String({
							description: "Relative paths under a directory source to exclude from this plan",
						}),
						{ description: "Relative paths to exclude" },
					),
				),
			}),
			async execute(_toolCallId, params, signal) {
				const engine = await ensureEngine();
				const raw = params as {
					source: string;
					include_suggested_text?: boolean;
					include_paths?: unknown;
					exclude_paths?: unknown;
				};
				const plan = engine.plan(resolveSource(raw.source), toAddOptions(raw), signal);
				const samples = plan.skipped.samples
					.map((sample) => `- ${sample.reason}: ${sample.path}${sample.size ? ` (${sample.size} bytes)` : ""}`)
					.join("\n");
				return {
					content: [
						{
							type: "text",
							text: [
								plan.summary,
								`Source type: ${plan.source_type}`,
								`Skipped summary: ${JSON.stringify(plan.skipped.by_reason)}`,
								samples ? `Skipped samples:\n${samples}` : "Skipped samples: none",
							].join("\n"),
						},
					],
					details: undefined,
				};
			},
		},

		{
			name: "knowledge_add",
			label: "Knowledge Add",
			description:
				"Index files, directories, URLs, PDFs, DOCX, or text into a named knowledge base for semantic search",
			parameters: Type.Object({
				source: Type.String({
					description: "File path, directory path, URL, PDF/DOCX path, or inline text to index",
				}),
				name: Type.String({ description: "Display name for this knowledge base" }),
				include_suggested_text: Type.Optional(
					Type.Boolean({
						description:
							"Include text files that are normally suggested for exclusion, such as vendor/build/runtime/cache/secret-named text, after user confirmation",
					}),
				),
				include_paths: Type.Optional(
					Type.Array(
						Type.String({
							description:
								"Relative paths under a directory source to include even when they match suggested-exclude patterns",
						}),
						{ description: "Relative paths to include" },
					),
				),
				exclude_paths: Type.Optional(
					Type.Array(
						Type.String({
							description: "Relative paths under a directory source to exclude from this KB",
						}),
						{ description: "Relative paths to exclude" },
					),
				),
			}),
			async execute(_toolCallId, params, signal, onUpdate) {
				const engine = await ensureEngine();
				const raw = params as {
					source: string;
					name: string;
					include_suggested_text?: boolean;
					include_paths?: unknown;
					exclude_paths?: unknown;
				};
				const { kb, chunkCount } = await engine.add(
					resolveSource(raw.source),
					raw.name,
					(msg) => onUpdate?.({ content: [{ type: "text", text: msg }], details: undefined }),
					signal,
					toAddOptions(raw),
				);
				return {
					content: [
						{
							type: "text",
							text: `Indexed "${kb.name}": ${chunkCount} chunks from ${kb.file_count} files. KB ID: ${kb.id}`,
						},
					],
					details: undefined,
				};
			},
		},

		{
			name: "knowledge_search",
			label: "Knowledge Search",
			description:
				"Search indexed knowledge bases using lexical BM25, semantic vectors, reranking, and filters",
			parameters: Type.Object({
				query: Type.String({ description: "Search query" }),
				mode: Type.Optional(
					Type.Union([
						Type.Literal("auto"),
						Type.Literal("fast"),
						Type.Literal("semantic"),
						Type.Literal("hybrid"),
						Type.Literal("deep"),
						Type.Literal("adaptive"),
						Type.Literal("code"),
						Type.Literal("config"),
						Type.Literal("docs"),
						Type.Literal("errors"),
						Type.Literal("decision"),
					]),
				),
				limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
				kb_id: Type.Optional(Type.String({ description: "Limit search to a specific KB by ID or exact name" })),
				offset: Type.Optional(Type.Number({ description: "Pagination offset" })),
				file_type: Type.Optional(
					Type.String({ description: "Filter by file type (e.g. typescript, markdown, python)" }),
				),
				path_pattern: Type.Optional(
					Type.String({ description: "Filter by file path substring (for example src/engine.ts)" }),
				),
				diversity: Type.Optional(
					Type.Union([Type.Literal("off"), Type.Literal("balanced"), Type.Literal("strong")]),
				),
				diagnostics: Type.Optional(
					Type.Boolean({ description: "Include ranking diagnostics and mode/fallback details in the result" }),
				),
			}),
			async execute(_toolCallId, params, signal) {
				const engine = await ensureEngine();
				const raw = params as {
					query: string;
					mode?: SearchMode;
					limit?: number;
					kb_id?: string;
					offset?: number;
					file_type?: string;
					path_pattern?: string;
					diversity?: "off" | "balanced" | "strong";
					diagnostics?: boolean;
				};
				const filters =
					raw.file_type || raw.path_pattern
						? { file_type: raw.file_type, path_pattern: raw.path_pattern }
						: undefined;
				const response: SearchResponse = await engine.search(
					raw.query,
					{
						mode: raw.mode,
						limit: raw.limit,
						kb_id: raw.kb_id,
						offset: raw.offset,
						filters,
						diversity: raw.diversity,
					},
					signal,
				);
				if (response.results.length === 0) {
					const details = [
						"No results found.",
						response.mode_used ? `Mode used: ${response.mode_used}` : "",
						response.retry_modes?.length ? `Retried: ${response.retry_modes.join(", ")}` : "",
						response.warnings?.length ? `Warnings: ${response.warnings.join(" | ")}` : "",
						response.suggestions?.length ? `Suggestions: ${response.suggestions.join(" | ")}` : "",
					]
						.filter(Boolean)
						.join("\n");
					return {
						content: [{ type: "text", text: details }],
						details: raw.diagnostics ? response : undefined,
					};
				}
				let output = `${response.total_count} results (showing ${response.results.length})`;
				if (response.mode_used) output += ` — mode: ${response.mode_used}`;
				if (response.retry_modes?.length) output += ` — retried: ${response.retry_modes.join(", ")}`;
				output += ":\n\n";
				if (response.warnings?.length) {
					output = `Warnings:\n- ${response.warnings.join("\n- ")}\n\n${output}`;
				}
				output += response.results
					.map((r, i) => {
						const diag =
							raw.diagnostics && r.ranking
								? `\nDiagnostics: base=${r.ranking.base_score.toFixed(3)}, adjusted=${r.ranking.adjusted_score.toFixed(
										3,
									)}, coverage=${r.ranking.coverage.toFixed(2)}, path_boost=${r.ranking.path_boost.toFixed(
										2,
									)}, source_boost=${r.ranking.source_boost.toFixed(2)}, test=${r.ranking.is_test}`
								: "";
						const provenance =
							raw.diagnostics && r.provenance
								? `\nProvenance: chunk=${r.provenance.chunk_id}, hash=${r.provenance.chunk_hash.slice(
										0,
										12,
									)}, reason=${r.provenance.match_reason}, indexed_at=${r.provenance.indexed_at}, source_mtime=${
										r.provenance.source_mtime ?? "unknown"
									}, stale=${r.provenance.stale}`
								: "";
						return `[${i + 1}] ${r.file_path} (${r.kb_name}, score: ${r.score.toFixed(3)})\n${r.snippet}${diag}${provenance}`;
					})
					.join("\n\n");
				return {
					content: [{ type: "text", text: output }],
					details: raw.diagnostics ? response : undefined,
				};
			},
		},

		{
			name: "knowledge_symbol_search",
			label: "Knowledge Symbol Search",
			description:
				"Search indexed code symbols, Markdown headings, config keys, and environment variables exactly or by substring",
			parameters: Type.Object({
				query: Type.String({ description: "Symbol, heading, config key, env var, route, or file text to find" }),
				kind: Type.Optional(
					Type.Union([
						Type.Literal("function"),
						Type.Literal("class"),
						Type.Literal("interface"),
						Type.Literal("type"),
						Type.Literal("variable"),
						Type.Literal("heading"),
						Type.Literal("config_key"),
						Type.Literal("env_var"),
						Type.Literal("route"),
					]),
				),
				kb_id: Type.Optional(Type.String({ description: "Limit lookup to a specific KB by ID or exact name" })),
				file_pattern: Type.Optional(Type.String({ description: "Limit lookup to paths containing this text" })),
				limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
				offset: Type.Optional(Type.Number({ description: "Pagination offset" })),
				exact: Type.Optional(Type.Boolean({ description: "Require exact normalized symbol/key match" })),
			}),
			async execute(_toolCallId, params, signal) {
				if (signal?.aborted) throw new Error("Cancelled");
				const engine = await ensureEngine();
				if (signal?.aborted) throw new Error("Cancelled");
				const raw = params as {
					query: string;
					kind?: SymbolSearchResponse["results"][number]["kind"];
					kb_id?: string;
					file_pattern?: string;
					limit?: number;
					offset?: number;
					exact?: boolean;
				};
				const response: SymbolSearchResponse = engine.symbolSearch(
					raw.query,
					{
						kind: raw.kind,
						kb_id: raw.kb_id,
						file_pattern: raw.file_pattern,
						limit: raw.limit,
						offset: raw.offset,
						exact: raw.exact === true,
					},
					signal,
				);
				if (response.results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No symbols found. This may mean the symbol is absent, symbol metadata is missing/stale, or the lightweight extractor does not cover this syntax. For important lookups, run knowledge_doctor or fallback to knowledge_search mode 'fast'/'adaptive'.",
							},
						],
						details: undefined,
					};
				}
				const lines = response.results.map((result, index) => {
					const signature = result.signature ? ` — ${result.signature}` : "";
					return `[${index + 1}] ${result.name} (${result.kind}) ${result.file_path}:${result.start_line}-${result.end_line} [${result.kb_name}]${signature}`;
				});
				const suffix = response.has_more ? "\nMore results available; increase offset to continue." : "";
				return {
					content: [
						{
							type: "text",
							text: `${response.total_count} symbol result(s):\n\n${lines.join("\n")}${suffix}`,
						},
					],
					details: undefined,
				};
			},
		},

		{
			name: "knowledge_update",
			label: "Knowledge Update",
			description:
				"Incrementally re-index a source-backed knowledge base with a retained file, directory, or URL source",
			parameters: Type.Object({
				target: Type.String({ description: "KB name or ID to update" }),
			}),
			async execute(_toolCallId, params, signal, onUpdate) {
				const engine = await ensureEngine();
				const { added, removed, unchanged } = await engine.update(
					(params as { target: string }).target,
					(msg) => onUpdate?.({ content: [{ type: "text", text: msg }], details: undefined }),
					signal,
				);
				return {
					content: [{ type: "text", text: `Updated: +${added} added, -${removed} removed, ${unchanged} unchanged.` }],
					details: undefined,
				};
			},
		},

		{
			name: "knowledge_status",
			label: "Knowledge Status",
			description: "Show knowledge engine status with health diagnostics: staleness, orphans, and coverage",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, signal) {
				if (signal?.aborted) throw new Error("Cancelled");
				const engine = await ensureEngine();
				const kbs = engine.list();
				const diagnostics = engine.diagnose(signal);
				const lines = [
					`Storage: ${cfg.indexDir}`,
					`Knowledge bases: ${kbs.length}`,
					"Active watchers: 0 (standalone mode)",
					"",
				];
				for (const kb of kbs) {
					const age = Math.round((Date.now() - kb.updated_at) / 60000);
					const diag = diagnostics.find((d) => d.kb_id === kb.id);
					lines.push(
						`  "${kb.name}" — ${kb.status} — ${kb.chunk_count} chunks, ${kb.file_count} files — updated ${age}m ago`,
					);
					if (kb.source_path) lines.push(`    source: ${kb.source_path}`);
					if (diag) {
						if (diag.job) {
							const jobAge = Math.round((Date.now() - diag.job.last_progress_at) / 1000);
							const jobProgress = [
								`${diag.job.processed_files} files`,
								`${diag.job.processed_chunks} chunks`,
								diag.job.skipped_total > 0 ? `${diag.job.skipped_total} skipped` : "",
								diag.job.added_chunks > 0 ? `+${diag.job.added_chunks}` : "",
								diag.job.removed_chunks > 0 ? `-${diag.job.removed_chunks}` : "",
								diag.job.unchanged_chunks > 0 ? `=${diag.job.unchanged_chunks}` : "",
							]
								.filter(Boolean)
								.join(", ");
							lines.push(
								`    job: ${diag.job.status}/${diag.job.phase} — ${jobProgress || "no processed items yet"} — last progress ${jobAge}s ago`,
							);
							if (diag.job.message) lines.push(`    last: ${diag.job.message}`);
							if (diag.job.error_message) lines.push(`    error: ${diag.job.error_message}`);
						}
						lines.push(
							`    coverage: ${diag.coverage_percent}% (${diag.indexed_files}/${diag.total_source_files} files)`,
						);
						if (diag.stale_files.length > 0)
							lines.push(`    ⚠️ stale: ${diag.stale_files.length} files modified since last index`);
						if (diag.orphan_files.length > 0)
							lines.push(`    ⚠️ orphans: ${diag.orphan_files.length} chunks reference deleted files`);
						if (diag.stuck_indexing)
							lines.push(
								`    ⚠️ indexing appears stuck for ${Math.round(diag.last_progress_age_ms / 60000)}m; remove and rebuild if no process is actively indexing it`,
							);
						if (diag.skipped_files.total > 0)
							lines.push(
								`    skipped: ${diag.skipped_files.total} files (${Object.entries(diag.skipped_files.by_reason)
									.filter(([, count]) => count > 0)
									.map(([reason, count]) => `${reason}: ${count}`)
									.join(", ")})`,
							);
					}
				}
				const totalStale = diagnostics.reduce((n, d) => n + d.stale_files.length, 0);
				const totalOrphans = diagnostics.reduce((n, d) => n + d.orphan_files.length, 0);
				const totalStuck = diagnostics.filter((d) => d.stuck_indexing).length;
				if (totalStale === 0 && totalOrphans === 0 && totalStuck === 0 && kbs.length > 0)
					lines.push("", "Health: ✓ all indexes up to date");
				else if (totalStale > 0 || totalOrphans > 0 || totalStuck > 0)
					lines.push(
						"",
						`Health: ⚠️ ${totalStale} stale, ${totalOrphans} orphans, ${totalStuck} stuck indexing — run knowledge_update or rebuild affected KBs`,
					);
				return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
			},
		},

		{
			name: "knowledge_doctor",
			label: "Knowledge Doctor",
			description: "Diagnose knowledge base health, skipped files, stale indexes, stuck jobs, and recommended fixes",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, signal) {
				if (signal?.aborted) throw new Error("Cancelled");
				const engine = await ensureEngine();
				const report: DoctorReport = engine.doctor(signal);
				const lines = [`Health score: ${report.health_score}/100`, report.summary, ""];
				if (report.issues.length === 0) {
					lines.push("No issues found.");
				} else {
					for (const issue of report.issues) {
						const scope = issue.kb_name ? ` [${issue.kb_name}]` : "";
						lines.push(`- ${issue.severity.toUpperCase()}${scope}: ${issue.message}`);
						lines.push(`  Action (${issue.action_code ?? "none"}): ${issue.action}`);
					}
				}
				return { content: [{ type: "text", text: lines.join("\n") }], details: report };
			},
		},

		{
			name: "knowledge_show",
			label: "Knowledge Show",
			description: "List all indexed knowledge bases",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, signal) {
				if (signal?.aborted) throw new Error("Cancelled");
				const engine = await ensureEngine();
				if (signal?.aborted) throw new Error("Cancelled");
				const kbs = engine.list(signal);
				if (kbs.length === 0) {
					return { content: [{ type: "text", text: "No knowledge bases." }], details: undefined };
				}
				const lines = kbs.map((kb) => `• ${kb.name} — ${kb.chunk_count} chunks, ${kb.file_count} files (${kb.status})`);
				return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
			},
		},

		{
			name: "knowledge_remove",
			label: "Knowledge Remove",
			description: "Remove a knowledge base by name or ID after explicit confirmation",
			parameters: Type.Object({
				target: Type.String({ description: "KB name or ID to remove" }),
				confirm: Type.Boolean({
					description: "Must be true after explicit user confirmation for this destructive operation",
				}),
			}),
			async execute(_toolCallId, params, signal) {
				if (signal?.aborted) throw new Error("Cancelled");
				const { target, confirm } = params as { target: string; confirm?: boolean };
				if (confirm !== true) throw new Error("Confirmation required: pass confirm=true for destructive removal");
				const engine = await ensureEngine();
				const ok = engine.remove(target);
				return { content: [{ type: "text", text: ok ? "Removed." : "Not found." }], details: undefined };
			},
		},

		{
			name: "knowledge_export",
			label: "Knowledge Export",
			description: "Export a knowledge base to a JSONL file (shareable, git-friendly)",
			parameters: Type.Object({
				target: Type.String({ description: "KB name or ID to export" }),
				output: Type.String({ description: "Output file path (.jsonl)" }),
			}),
			async execute(_toolCallId, params, signal, onUpdate) {
				const engine = await ensureEngine();
				const { target, output } = params as { target: string; output: string };
				const count = await engine.exportKB(
					target,
					output,
					signal,
					(msg) => onUpdate?.({ content: [{ type: "text", text: msg }], details: undefined }),
				);
				return { content: [{ type: "text", text: `Exported ${count} chunks to ${output}` }], details: undefined };
			},
		},

		{
			name: "knowledge_import",
			label: "Knowledge Import",
			description: "Import a knowledge base from a JSONL file (re-embeds content)",
			parameters: Type.Object({
				input: Type.String({ description: "Input JSONL file path" }),
			}),
			async execute(_toolCallId, params, signal, onUpdate) {
				const engine = await ensureEngine();
				const { kb, chunkCount } = await engine.importKB(
					(params as { input: string }).input,
					(msg) => onUpdate?.({ content: [{ type: "text", text: msg }], details: undefined }),
					signal,
				);
				return {
					content: [{ type: "text", text: `Imported "${kb.name}": ${chunkCount} chunks (re-embedded)` }],
					details: undefined,
				};
			},
		},

		{
			name: "knowledge_clear",
			label: "Knowledge Clear",
			description: "Remove all knowledge bases after explicit confirmation",
			parameters: Type.Object({
				confirm: Type.Boolean({
					description: "Must be true after explicit user confirmation for this destructive operation",
				}),
			}),
			async execute(_toolCallId, params, signal) {
				if (signal?.aborted) throw new Error("Cancelled");
				if ((params as { confirm?: boolean }).confirm !== true) {
					throw new Error("Confirmation required: pass confirm=true for destructive clear");
				}
				const engine = await ensureEngine();
				engine.clear();
				return { content: [{ type: "text", text: "All knowledge bases cleared." }], details: undefined };
			},
		},
	];
}

// Re-export the engine for callers that want direct RAG access.
export { KnowledgeEngine };
