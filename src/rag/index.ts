/**
 * RAG module facade for the deeptutor standalone app.
 *
 * This is a vendored, de-pi-ified copy of the pi-knowledge extension's core
 * engine. There is no extension registration layer here; consumers construct a
 * {@link KnowledgeEngine} with explicit `dataDir` and embedding options.
 */
export { KnowledgeEngine } from "./engine.js";
export type { KnowledgeEngineOptions } from "./engine.js";
export type {
	AddOptions,
	DoctorIssue,
	DoctorReport,
	IndexPlan,
	ProgressCallback,
	SearchMode,
	SearchOptions,
	SearchResponse,
	SearchResult,
	SymbolSearchOptions,
	SymbolSearchResponse,
} from "./engine.js";
