import { embedInModelWorker } from "../model-worker-client.js";

export interface EmbeddingProviderOptions {
	/**
	 * Embedding configuration, `"provider[:model]"`.
	 * `"local"` (or any `"local:*"`) routes through the transformers model
	 * worker; `"openai"` (or any other provider string) uses the
	 * OpenAI-compatible HTTP API.
	 */
	provider: string;
	/** Base URL for the OpenAI-compatible embedding endpoint. */
	baseUrl?: string;
	/** API key for the OpenAI-compatible endpoint (optional for local servers). */
	apiKey?: string;
	/** If `"local"`, fall back to the local transformers worker when the API fails. */
	fallback?: string;
	/** Max chars per embedded text. */
	maxChars?: number;
	/** Idle dispose timeout in ms (only honored when enableNativeIdleDispose is set). */
	idleMs?: number;
	/** Enable native idle dispose of the local worker. */
	enableNativeIdleDispose?: boolean;
}

const DEFAULT_PROVIDER = "openai";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_API_MAX_EMBED_CHARS = 20_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

let config: Required<EmbeddingProviderOptions> = {
	provider: DEFAULT_PROVIDER,
	baseUrl: DEFAULT_BASE_URL,
	apiKey: "",
	fallback: "",
	maxChars: DEFAULT_API_MAX_EMBED_CHARS,
	idleMs: DEFAULT_IDLE_TIMEOUT_MS,
	enableNativeIdleDispose: false,
};

/** Configure the embedding provider. Called by the KnowledgeEngine constructor. */
export function configureEmbedding(options: EmbeddingProviderOptions): void {
	config = {
		...config,
		...options,
		baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
		apiKey: options.apiKey ?? "",
		fallback: options.fallback ?? "",
		maxChars:
			Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
				? Number(options.maxChars)
				: DEFAULT_API_MAX_EMBED_CHARS,
		idleMs: Number(options.idleMs) > 0 ? Number(options.idleMs) : DEFAULT_IDLE_TIMEOUT_MS,
		enableNativeIdleDispose: options.enableNativeIdleDispose === true,
	};
}

let disposeTimer: ReturnType<typeof setTimeout> | null = null;
let disposePromise: Promise<void> | null = null;
let activeRuns = 0;
let disposeRequested = false;
const idleWaiters: Array<() => void> = [];

function isAbortError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function clearIdleTimer(): void {
	if (disposeTimer) clearTimeout(disposeTimer);
	disposeTimer = null;
}

function scheduleIdleDispose(): void {
	if (activeRuns > 0 || disposeRequested) return;
	clearIdleTimer();
	if (!config.enableNativeIdleDispose) return;
	disposeTimer = setTimeout(() => dispose(), config.idleMs);
}

function beginRun(): void {
	activeRuns++;
	clearIdleTimer();
}

function endRun(): void {
	activeRuns--;
	if (activeRuns > 0) return;
	for (const resolve of idleWaiters.splice(0)) resolve();
	if (!disposeRequested) scheduleIdleDispose();
}

function waitForNoActiveRuns(): Promise<void> {
	if (activeRuns === 0) return Promise.resolve();
	return new Promise((resolve) => idleWaiters.push(resolve));
}

export async function dispose(): Promise<void> {
	clearIdleTimer();
	if (disposePromise) return disposePromise;
	disposeRequested = true;
	await waitForNoActiveRuns();
	disposePromise = Promise.resolve().finally(() => {
		disposePromise = null;
		disposeRequested = false;
	});
	return disposePromise;
}

export async function prepareForShutdown(): Promise<void> {
	clearIdleTimer();
	await waitForNoActiveRuns();
}

async function embedViaAPI(
	texts: string[],
	prefix: "query" | "passage",
	signal?: AbortSignal,
): Promise<Float32Array[]> {
	const [provider, model] = config.provider.split(":");
	const maxChars = config.maxChars;
	const prefixedTexts = texts.map((t) => `${prefix}: ${t}`);
	const safeTexts = prefixedTexts.map((text) => (text.length > maxChars ? text.slice(0, maxChars) : text));

	if (provider === "openai") {
		const apiKey = config.apiKey;
		const baseUrl = config.baseUrl;
		const endpoint = new URL("embeddings", `${baseUrl.replace(/\/+$/, "")}/`);
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		// Local OpenAI-compatible servers (e.g. Ollama) may not require a key.
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const res = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify({ input: safeTexts, model: model || "text-embedding-3-small" }),
			signal,
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			throw new Error(`OpenAI embedding API error: ${res.status}${detail ? ` ${detail.slice(0, 500)}` : ""}`);
		}
		const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
		return data.data.map((d) => new Float32Array(d.embedding));
	}

	throw new Error(`Unsupported embedding provider: ${provider}`);
}

export async function embedTexts(
	texts: string[],
	prefix: "query" | "passage",
	signal?: AbortSignal,
): Promise<Float32Array[]> {
	if (!config.provider.startsWith("local")) {
		if (signal?.aborted) throw new Error("Cancelled");
		try {
			return await embedViaAPI(texts, prefix, signal);
		} catch (error) {
			if (signal?.aborted || isAbortError(error)) throw new Error("Cancelled");
			if (config.fallback !== "local") throw error;
			console.warn(
				`pi-knowledge: embedding API failed; falling back to local model because fallback=local (${error instanceof Error ? error.message : String(error)})`,
			);
		}
	}
	beginRun();
	try {
		return await embedInModelWorker(texts, prefix, signal);
	} finally {
		endRun();
	}
}

export async function embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array> {
	const [vec] = await embedTexts([text], "query", signal);
	return vec;
}

export async function embedDocuments(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
	return embedTexts(texts, "passage", signal);
}
