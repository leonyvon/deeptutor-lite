import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ── Types ──

interface KBConfig {
  rootDir: string;
  defaultKB: string;
}

type KnowledgeType = "memory" | "procedure" | "concept" | "design";
type QuestionType = "choice" | "short" | "open";

// Old-style status for backward compat; new code uses LearningStage.
type LegacyStatus = "not_started" | "in_progress" | "completed";
type LearningStage = "diagnostic" | "explain" | "feynman_check" | "practice" | "error_diagnosis" | "review" | "completed";

type ErrorType = "structural" | "deviational" | "application" | "metacognitive";
type ErrorStatus = "active" | "retrying" | "graduated";

// ── Interfaces ──

interface QuizAttempt {
  timestamp: number;
  isCorrect: boolean;
  userAnswer: string;
}

interface PendingQuestion {
  questionId: string;
  question: string;
  expectedAnswer: string;
  questionType: QuestionType;
  options: Record<string, string> | null;
}

interface RetryAttempt {
  timestamp: number;
  isCorrect: boolean;
  attemptNumber: number;
}

interface ErrorRecord {
  errorType: ErrorType;
  status: ErrorStatus;
  questionId: string;
  timestamp: number;
  retryHistory: RetryAttempt[];
  aiConfirmation: boolean;
}

interface SRState {
  consecutiveCorrect: number;
  consecutiveWrong: number;
  nextReviewAt: number; // epoch ms
  interval: number;     // current interval in days
  easeFactor: number;
  intervalIndex: number;
}

interface ReviewTask {
  knowledgePointId: string;
  knowledgeType: KnowledgeType;
  dueAt: number;
  priority: number;
}

interface TopicSummary {
  topic: string;
  type: KnowledgeType;
  stage: LearningStage;
  status: "mastered" | "learning" | "new";
  masteryScore: number;
  difficulty: number;
  description: string;
  prerequisites: string[];
}

interface MapSummary {
  totalTopics: number;
  masteredTopics: number;
  learningTopics: number;
  newTopics: number;
  masteryPercent: number;
  modules: ModuleSummary[];
}

interface ModuleSummary {
  name: string;
  mastered: number;
  total: number;
  percent: number;
}

interface ModuleDef {
  name: string;
  order: number;
  knowledgePoints: KnowledgePointDef[];
}

interface KnowledgePointDef {
  name: string;
  type: KnowledgeType;
  prerequisites: string[];
}

interface KModule {
  name: string;
  order: number;
  knowledgePoints: string[]; // references topic names
}

interface DiagnosticResultItem {
  knowledgePointId: string;
  passed: boolean;
}

// ── MasteryTopic (with ALL new fields, backward-compatible defaults) ──

interface MasteryTopic {
  topic: string;
  prerequisites: string[];
  difficulty: number;
  /** Legacy status — kept for backward compat with old readers.
   *  New logic uses `stage` (LearningStage); this field is derived/backfilled. */
  status: LegacyStatus;
  description: string;
  type: KnowledgeType;
  attempts: QuizAttempt[];
  pendingQuestion: PendingQuestion | null;

  // Feature 2: Feynman assessment fields
  feynmanRetries: number;
  feynmanExplanation: string;

  // Feature 3: Error tracking
  errorRecords: ErrorRecord[];

  // Feature 5: Spaced Repetition
  srState: SRState | null;

  // Feature 6: LearningStage state machine
  stage: LearningStage;
  stageFailureCounts: Record<string, number>;
  stageFailureNotes: Record<string, string>;

  // Feature 8: Diagnostic pre-test
  diagnosticPassed: boolean;
  diagnosticTimestamp: number;
}

interface MasteryData {
  kbName: string;
  generatedAt: string;
  path: MasteryTopic[];
  /** Optional module structure (set by mastery_build). Flat path is always the source of truth. */
  modules: KModule[] | null;
  /** Modules metadata for map summary (set by mastery_build) */
  moduleNames: string[] | null;
}

// ── Interval Sequences (by KnowledgeType, ported from deeptutor scheduler.py) ──

const INTERVAL_SEQUENCES: Record<KnowledgeType, number[]> = {
  memory: [0, 1, 3, 7, 14, 30, 60],
  procedure: [0, 1, 3, 7, 14, 30, 60],
  concept: [0, 3, 7, 14, 30, 60],
  design: [0, 7, 14, 30, 60],
};

// ── Semantic Grading via Ollama embedding (cosine similarity) ──
// choice questions use exact label match; short/open use embedding similarity ≥ 0.85

function wrapLines(text: string, width: number): string[] {
  if (!text || width <= 0) return [text];
  const result: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    let cut = width;
    while (cut > 0 && remaining[cut] !== " " && !/[，。、；：？！\s,.;:?!]/.test(remaining[cut])) cut--;
    if (cut <= width / 3) cut = width;
    result.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) result.push(remaining);
  return result.length ? result : [text];
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot(a, b) / n;
}

let _embedCache: Map<string, number[]> | null = null;

async function getEmbedding(text: string): Promise<number[]> {
  if (!_embedCache) _embedCache = new Map();
  const cached = _embedCache.get(text);
  if (cached) return cached;

  const resp = await fetch("http://127.0.0.1:11434/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: [text] }),
  });
  if (!resp.ok) throw new Error(`Ollama embed failed: ${resp.status}`);
  const data = (await resp.json()) as { embeddings: number[][] };
  const vec = data.embeddings[0];
  _embedCache.set(text, vec);
  return vec;
}

async function semanticSimilarity(a: string, b: string): Promise<number> {
  try {
    const [va, vb] = await Promise.all([getEmbedding(a), getEmbedding(b)]);
    return cosineSimilarity(va, vb);
  } catch {
    return 0;
  }
}

async function gradeAnswer(userAnswer: string, expectedAnswer: string, questionType: QuestionType): Promise<boolean> {
  if (!expectedAnswer) return false;

  // choice: exact label match
  if (questionType === "choice") {
    const userNorm = userAnswer.trim().replace(/\s/g, "").toLowerCase();
    const expectedNorm = expectedAnswer.trim().replace(/\s/g, "").toLowerCase();
    return userNorm === expectedNorm;
  }

  // short / open: semantic similarity via Ollama embedding
  const semScore = await semanticSimilarity(userAnswer.trim(), expectedAnswer.trim());
  return semScore >= 0.85;
}

// ── Recency-Weighted Mastery (ported from deeptutor learning/mastery.py) ──

const RECENCY_WEIGHTS: number[] = [0.5, 0.7, 0.85, 0.95, 1.0];
const CONFIDENCE_CAP: Record<number, number> = { 1: 0.5, 2: 0.8 };
const MASTERY_THRESHOLD = 0.9;

function computeMastery(attempts: QuizAttempt[]): number {
  if (attempts.length === 0) return 0.0;

  const recent = attempts.slice(-RECENCY_WEIGHTS.length);
  const correctness = recent.map((a) => a.isCorrect);
  const weights = RECENCY_WEIGHTS.slice(-recent.length);

  let weightedSum = 0;
  let weightSum = 0;
  for (let i = 0; i < recent.length; i++) {
    weightedSum += weights[i] * (correctness[i] ? 1.0 : 0.0);
    weightSum += weights[i];
  }

  const raw = weightSum > 0 ? weightedSum / weightSum : 0.0;
  const cap = CONFIDENCE_CAP[recent.length] ?? 1.0;
  return Math.min(raw, cap);
}

// ── LearningStage helpers ──

/** Map old-style status to LearningStage (backward compat). */
function legacyStage(s: string): LearningStage {
  switch (s) {
    case "not_started": return "diagnostic";
    case "in_progress": return "practice";
    case "completed":   return "completed";
    default:            return "diagnostic";
  }
}

/** Compute topic-level status string for map summary. */
function objectiveStatus(topic: MasteryTopic): "mastered" | "learning" | "new" {
  if (isMastered(topic)) return "mastered";
  const seen = topic.attempts.length > 0 ||
    topic.stage !== "diagnostic" ||
    topic.feynmanExplanation !== "" ||
    topic.errorRecords.length > 0;
  return seen ? "learning" : "new";
}

// ── Mastery Gate ──

function isMastered(topic: MasteryTopic): boolean {
  if (topic.type === "concept" || topic.type === "design") {
    // Qualitative gate: completed via Feynman check
    return topic.stage === "completed";
  }
  // Quantitative gate: memory / procedure
  const score = computeMastery(topic.attempts);
  return score >= MASTERY_THRESHOLD;
}

function getDisplayMastery(topic: MasteryTopic): number {
  if (topic.type === "concept" || topic.type === "design") {
    return topic.stage === "completed" ? 1.0 : 0.0;
  }
  return computeMastery(topic.attempts);
}

function getGateKind(topic: MasteryTopic): "qualitative" | "quantitative" {
  return (topic.type === "concept" || topic.type === "design") ? "qualitative" : "quantitative";
}

// ── Spaced Repetition Scheduler (ported from deeptutor scheduler.py) ──

function initSRState(knowledgeType: KnowledgeType): SRState {
  const intervals = INTERVAL_SEQUENCES[knowledgeType];
  return {
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    nextReviewAt: Date.now() + intervals[0] * 86400000,
    interval: intervals[0],
    easeFactor: 2.5,
    intervalIndex: 0,
  };
}

function scheduleNextSR(state: SRState, knowledgeType: KnowledgeType, isCorrect: boolean): SRState {
  const intervals = INTERVAL_SEQUENCES[knowledgeType];
  const maxIndex = intervals.length - 1;
  const s = { ...state };

  if (isCorrect) {
    s.consecutiveWrong = 0;
    s.consecutiveCorrect += 1;
    // Advance 2 indices if 2+ consecutive correct (matches Python: consecutive_correct >= 2 → +=2)
    if (s.consecutiveCorrect >= 2) {
      s.intervalIndex = Math.min(s.intervalIndex + 2, maxIndex);
      s.consecutiveCorrect = 0;
    } else {
      s.intervalIndex = Math.min(s.intervalIndex + 1, maxIndex);
    }
  } else {
    s.consecutiveWrong += 1;
    s.consecutiveCorrect = 0;
    s.intervalIndex = Math.max(0, s.intervalIndex - 1);
    if (s.consecutiveWrong >= 2) {
      s.consecutiveWrong = 0;
    }
  }

  s.interval = intervals[s.intervalIndex];
  s.nextReviewAt = Date.now() + s.interval * 86400000;
  return s;
}

// ── Error Classification (ported from deeptutor grading.py:52-61) ──

function classifyError(userAnswer: string): ErrorType {
  const trimmed = userAnswer.trim();
  if (trimmed.length === 0) return "metacognitive";
  // The richer 4-type classification is delegated to the agent (LLM).
  // For deterministic grading, blank → metacognitive, otherwise → application.
  return "application";
}

// ── Persistence ──

async function readMastery(kbPath: string): Promise<MasteryData | null> {
  const file = join(kbPath, ".mastery.json");
  try {
    const raw = await readFile(file, "utf-8");
    const data = JSON.parse(raw);
    // Backward compat: normalize old-format topics with ALL new fields defaulted
    data.path = (data.path ?? []).map((t: any) => ({
      topic: t.topic ?? "",
      prerequisites: t.prerequisites ?? [],
      difficulty: t.difficulty ?? 1,
      description: t.description ?? "",
      type: (["memory", "procedure", "concept", "design"].includes(t.type) ? t.type : "memory") as KnowledgeType,
      attempts: (t.attempts ?? []) as QuizAttempt[],
      pendingQuestion: (t.pendingQuestion ?? null) as PendingQuestion | null,
      // Legacy status mapping
      status: (["not_started", "in_progress", "completed"].includes(t.status) ? t.status : "not_started") as LegacyStatus,
      // New fields with defaults
      stage: (["diagnostic", "explain", "feynman_check", "practice", "error_diagnosis", "review", "completed"].includes(t.stage)
        ? t.stage
        : legacyStage(t.status ?? "not_started")) as LearningStage,
      feynmanRetries: t.feynmanRetries ?? 0,
      feynmanExplanation: t.feynmanExplanation ?? "",
      errorRecords: (t.errorRecords ?? []).map((e: any) => ({
        errorType: (["structural", "deviational", "application", "metacognitive"].includes(e.errorType) ? e.errorType : "application") as ErrorType,
        status: (["active", "retrying", "graduated"].includes(e.status) ? e.status : "active") as ErrorStatus,
        questionId: e.questionId ?? "",
        timestamp: e.timestamp ?? 0,
        retryHistory: (e.retryHistory ?? []).map((r: any) => ({
          timestamp: r.timestamp ?? 0,
          isCorrect: r.isCorrect ?? false,
          attemptNumber: r.attemptNumber ?? 0,
        })),
        aiConfirmation: e.aiConfirmation ?? false,
      })),
      srState: t.srState ? {
        consecutiveCorrect: t.srState.consecutiveCorrect ?? 0,
        consecutiveWrong: t.srState.consecutiveWrong ?? 0,
        nextReviewAt: t.srState.nextReviewAt ?? Date.now(),
        interval: t.srState.interval ?? 0,
        easeFactor: t.srState.easeFactor ?? 2.5,
        intervalIndex: t.srState.intervalIndex ?? 0,
      } : null,
      stageFailureCounts: t.stageFailureCounts ?? {},
      stageFailureNotes: t.stageFailureNotes ?? {},
      diagnosticPassed: t.diagnosticPassed ?? false,
      diagnosticTimestamp: t.diagnosticTimestamp ?? 0,
    }));
    // Backward compat: modules field
    data.modules = data.modules ?? null;
    data.moduleNames = data.moduleNames ?? null;
    return data;
  } catch {
    return null;
  }
}

async function writeMastery(kbPath: string, data: MasteryData): Promise<void> {
  const file = join(kbPath, ".mastery.json");
  await writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

function findTopic(data: MasteryData, topicName: string): MasteryTopic | undefined {
  return data.path.find((t) => t.topic.toLowerCase() === topicName.toLowerCase());
}

// ── Next Topic After Update ──

function nextTopicAfterUpdate(data: MasteryData): MasteryTopic | null {
  const completed = new Set(
    data.path.filter((t) => isMastered(t)).map((t) => t.topic.toLowerCase())
  );
  return (
    data.path.find(
      (t) =>
        !isMastered(t) &&
        t.prerequisites.every((p) => completed.has(p.toLowerCase()))
    ) ?? null
  );
}

// ── Due Reviews ──

function getDueReviews(data: MasteryData): ReviewTask[] {
  const now = Date.now();
  const due: ReviewTask[] = [];
  for (const t of data.path) {
    if (t.srState && t.srState.nextReviewAt <= now) {
      const priority = t.errorRecords.some((e) => e.status === "active" || e.status === "retrying") ? 1 : 2;
      due.push({
        knowledgePointId: t.topic,
        knowledgeType: t.type,
        dueAt: t.srState.nextReviewAt,
        priority,
      });
    }
  }
  due.sort((a, b) => a.priority - b.priority);
  return due;
}

// ── Map Summary Builder (Feature 4) ──

function buildMapSummary(data: MasteryData): MapSummary {
  let mastered = 0, learning = 0, newCount = 0;
  const total = data.path.length;

  for (const t of data.path) {
    const s = objectiveStatus(t);
    if (s === "mastered") mastered++;
    else if (s === "learning") learning++;
    else newCount++;
  }

  const masteryPercent = total > 0 ? Math.round((mastered / total) * 100) : 0;

  // Build per-module summary if modules exist
  let modules: ModuleSummary[] = [];
  if (data.modules && data.moduleNames) {
    for (const mod of data.modules) {
      const kps = mod.knowledgePoints.map((name) => data.path.find((t) => t.topic.toLowerCase() === name.toLowerCase())).filter(Boolean) as MasteryTopic[];
      const modMastered = kps.filter((t) => isMastered(t)).length;
      modules.push({
        name: mod.name,
        mastered: modMastered,
        total: kps.length,
        percent: kps.length > 0 ? Math.round((modMastered / kps.length) * 100) : 0,
      });
    }
  } else {
    // Single implicit module
    modules = [{
      name: data.kbName,
      mastered,
      total,
      percent: masteryPercent,
    }];
  }

  return {
    totalTopics: total,
    masteredTopics: mastered,
    learningTopics: learning,
    newTopics: newCount,
    masteryPercent,
    modules,
  };
}

// ── Sanitize name to ID ──

function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || `kp-${randomUUID().slice(0, 8)}`;
}

// ══════════════════════════════════════════════════════════════════════
// REGISTER TOOLS
// ══════════════════════════════════════════════════════════════════════

export function registerMasteryTracker(pi: ExtensionAPI, config: KBConfig) {

  // ═══ mastery_generate (existing, updated for new fields) ═══
  pi.registerTool({
    name: "mastery_generate",
    label: "Generate Learning Path",
    description:
      "Generate a structured learning path from a knowledge base. Each topic must specify a type: memory (factual recall), procedure (step-by-step skill), concept (understanding), or design (creative application). The agent should first use knowledge_search to discover topics, assign appropriate types based on topic nature, then call this tool. After generating, call mastery_status to find the first topic to work on.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      path: Type.Array(
        Type.Object({
          topic: Type.String({ description: "Topic name" }),
          prerequisites: Type.Array(Type.String(), {
            description: "List of prerequisite topic names",
          }),
          difficulty: Type.Number({
            description: "Difficulty level 1-5 (1=easiest)",
          }),
          type: Type.String({
            description: "Knowledge type: memory, procedure, concept, or design",
          }),
          description: Type.String({ description: "Brief topic description" }),
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      try {
        await access(kbPath);
      } catch {
        return {
          content: [{ type: "text", text: `Knowledge base "${params.kb_name}" does not exist.` }],
          details: { success: false },
        };
      }

      const valid: KnowledgeType[] = ["memory", "procedure", "concept", "design"];
      const topics: MasteryTopic[] = params.path.map((t: any) => ({
        topic: t.topic,
        prerequisites: t.prerequisites ?? [],
        difficulty: t.difficulty ?? 1,
        status: "not_started" as LegacyStatus,
        description: t.description ?? "",
        type: valid.includes(t.type) ? (t.type as KnowledgeType) : "memory",
        attempts: [],
        pendingQuestion: null,
        // New fields — defaults
        stage: "diagnostic" as LearningStage,
        feynmanRetries: 0,
        feynmanExplanation: "",
        errorRecords: [],
        srState: null,
        stageFailureCounts: {},
        stageFailureNotes: {},
        diagnosticPassed: false,
        diagnosticTimestamp: 0,
      }));

      const data: MasteryData = {
        kbName: params.kb_name,
        generatedAt: new Date().toISOString(),
        path: topics,
        modules: null,
        moduleNames: null,
      };

      await writeMastery(kbPath, data);

      const summary = topics.map((t) => ({
        topic: t.topic,
        type: t.type,
        difficulty: t.difficulty,
        prerequisites: t.prerequisites,
        stage: t.stage,
        masteryScore: 0,
        mastered: false,
        gate: getGateKind(t),
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, kbName: params.kb_name, topicCount: topics.length, path: summary }, null, 2) }],
        details: { success: true, topicCount: topics.length },
      };
    },
  });

  // ═══ mastery_quiz (existing, minor update to set stage) ═══
  pi.registerTool({
    name: "mastery_quiz",
    label: "Quiz a Topic (Mastery Path)",
    description:
      "Pose a quiz question for a specific topic in the learning path. This stores the expected answer deterministically — grading will NOT use AI judgement, but exact/similarity matching. "
      + "IMPORTANT flow: When called with `options` (choice question) in a TUI session, this tool PRESENTS the question interactively to the learner AND captures their answer. "
      + "If the response includes `userAnswer`, the question was already answered — do NOT present it again. Just call `mastery_grade` with that answer."
      + " For MEMORY/PROCEDURE topics, the learner must score ≥90% over multiple attempts. For CONCEPT/DESIGN topics, use mastery_assess.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      topic: Type.String({ description: "Topic name to quiz on" }),
      question: Type.String({ description: "The question text. Include code snippets (backticks or fenced blocks) when the topic involves code." }),
      question_type: Type.String({
        description: "Grading algorithm: choice (exact match), short (≥85% similarity, max 30 chars), open (≥60% keyword match)",
      }),
      expected_answer: Type.String({ description: "The correct answer for deterministic grading" }),
      options: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "For choice questions: e.g. {A: 'option A', B: 'option B'}",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      const data = await readMastery(kbPath);

      if (!data) {
        return {
          content: [{ type: "text", text: `No learning path found for "${params.kb_name}". Use mastery_generate first.` }],
          details: { success: false },
        };
      }

      const topic = findTopic(data, params.topic);
      if (!topic) {
        return {
          content: [{ type: "text", text: `Topic "${params.topic}" not found in learning path.` }],
          details: { success: false },
        };
      }

      if (topic.type === "concept" || topic.type === "design") {
        return {
          content: [{
            type: "text",
            text: `"${topic.topic}" is a ${topic.type} topic. Instead of quiz, ask the learner to explain it in their own words (Feynman check). If the explanation is correct and complete, call mastery_assess with passed=true.`,
          }],
          details: { skipQuiz: true, topicType: topic.type },
        };
      }

      const pending: PendingQuestion = {
        questionId: randomUUID(),
        question: params.question,
        expectedAnswer: params.expected_answer,
        questionType: params.question_type as QuestionType,
        options: params.options ?? null,
      };

      topic.pendingQuestion = pending;
      if (topic.stage === "diagnostic") {
        topic.stage = "diagnostic"; // stays diagnostic — grade will advance
      } else if (topic.stage === "practice" || topic.stage === "error_diagnosis") {
        topic.stage = "practice";
      }
      topic.status = "in_progress";
      await writeMastery(kbPath, data);

      // ── Interactive choice presentation via TUI ──
      const isChoice = params.question_type === "choice";
      const hasOpts = params.options && Object.keys(params.options).length > 0;

      if ((ctx as any).hasUI && isChoice && hasOpts) {
        const entries = Object.entries(params.options!);
        const question = params.question;

        try {
          const result = await (ctx as any).ui.custom<string | null>((tui: any, theme: any, _kb: any, done: (v: string | null) => void) => {
            let sel = 0;
            const acc = (s: string) => theme.fg("accent", s);
            const dim = (s: string) => theme.fg("dim", s);

            const render = (width: number): string[] => {
              const w = Math.max(30, width - 6);
              const lines: string[] = [];
              lines.push(acc(`╭─ Quiz ${"─".repeat(Math.max(0, w - 8))}╮`));
              for (const chunk of wrapLines(question, w - 2)) {
                lines.push(`${acc("│")} ${theme.bold(chunk).padEnd(w - 2)} ${acc("│")}`);
              }
              lines.push(`${acc("│")}${"─".repeat(w)}${acc("│")}`);
              for (let i = 0; i < entries.length; i++) {
                const prefix = i === sel ? acc("→") : " ";
                const optText = `${prefix} ${entries[i][0]}) ${entries[i][1]}`;
                for (const chunk of wrapLines(optText, w - 2)) {
                  lines.push(`${acc("│")} ${(i === sel ? acc(chunk) : chunk).padEnd(w - 2)} ${acc("│")}`);
                }
              }
              lines.push(`${acc("│")}${"─".repeat(w)}${acc("│")}`);
              lines.push(`${acc("│")} ${dim("↑↓ nav  enter select  esc cancel").padEnd(w - 2)} ${acc("│")}`);
              lines.push(acc(`╰${"─".repeat(w)}╯`));
              return lines;
            };

            const handleInput = (data: string) => {
              if (data === "\x1b[A" || data === "\x1bOA") { sel = sel === 0 ? entries.length - 1 : sel - 1; return true; }
              if (data === "\x1b[B" || data === "\x1bOB") { sel = sel === entries.length - 1 ? 0 : sel + 1; return true; }
              if (data === "\r" || data === "\n") { done(`${entries[sel][0]}: ${entries[sel][1]}`); return true; }
              if (data === "\x1b" || data === "\x03") { done(null); return true; }
              return false;
            };

            return { render, invalidate: () => {}, handleInput };
          }, { overlay: true });

          if (result) {
            const userAnswer = (result.match(/^([A-Da-d])/) ?? [])[1]?.toUpperCase() ?? "A";
            return {
              content: [{ type: "text", text: JSON.stringify({
                success: true,
                alreadyAnswered: true,
                topic: topic.topic,
                question: params.question,
                options: params.options,
                userAnswer,
                nextStep: `mastery_grade(kb_name="${params.kb_name}", topic="${params.topic}", answer="${userAnswer}")`,
                instruction: "This question was already presented interactively and answered. Call mastery_grade with the answer above — do NOT present the question again.",
              }, null, 2) }],
              details: { success: true, questionId: pending.questionId, userAnswer },
            };
          }
        } catch {
          // UI failed — fall through to text mode
        }
      }

      // ── Fallback: text-based (no TUI, or non-choice question) ──
      const lines: string[] = [params.question];
      if (params.options && Object.keys(params.options).length > 0) {
        lines.push("");
        for (const [label, text] of Object.entries(params.options)) {
          lines.push(`${label}) ${text}`);
        }
      }
      lines.push("");
      lines.push(`*Type your answer${isChoice ? " (A/B/C)" : ""} — the agent will grade it automatically.*`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          success: true,
          questionId: pending.questionId,
          topic: topic.topic,
          questionType: params.question_type,
          expectedAnswer: params.expected_answer,
          options: params.options ?? null,
          kb_name: params.kb_name,
        },
      };
    },
  });

  // ═══ mastery_grade (updated: ErrorRecord, SRS, LearningStage) ═══
  pi.registerTool({
    name: "mastery_grade",
    label: "Grade Quiz Answer (Mastery Path)",
    description:
      "Grade the learner's answer to the pending quiz question using deterministic matching. Computes recency-weighted mastery score (newer answers count more). Mastery is capped at 50% after 1 attempt and 80% after 2 — the learner MUST answer correctly 3+ times to reach the 90% gate. On wrong answers, creates an ErrorRecord (error type: blank→metacognitive, otherwise→application) and updates the LearningStage. On correct answers, advances the spaced-repetition schedule. Returns whether the topic is now mastered, the current stage, error info, and the next recommended objective.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      topic: Type.String({ description: "Topic name the quiz was about" }),
      answer: Type.String({ description: "The learner's answer, verbatim" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      const data = await readMastery(kbPath);

      if (!data) {
        return {
          content: [{ type: "text", text: `No learning path found for "${params.kb_name}".` }],
          details: { success: false },
        };
      }

      const topic = findTopic(data, params.topic);
      if (!topic) {
        return {
          content: [{ type: "text", text: `Topic "${params.topic}" not found.` }],
          details: { success: false },
        };
      }

      if (!topic.pendingQuestion) {
        return {
          content: [{
            type: "text",
            text: `No pending question for "${topic.topic}". Pose one with mastery_quiz first, or use mastery_update for manual status changes.`,
          }],
          details: { success: false },
        };
      }

      const isCorrect = await gradeAnswer(params.answer, topic.pendingQuestion.expectedAnswer, topic.pendingQuestion.questionType);

      // Record attempt
      topic.attempts.push({
        timestamp: Date.now(),
        isCorrect,
        userAnswer: params.answer,
      });

      const qId = topic.pendingQuestion.questionId;
      topic.pendingQuestion = null;

      // ── ErrorRecord (Feature 3) ──
      let errorInfo: Record<string, any> | null = null;
      if (!isCorrect) {
        const errType = classifyError(params.answer);
        const existingErrIdx = topic.errorRecords.findIndex(
          (e) => e.questionId === qId
        );
        const errRec: ErrorRecord = {
          errorType: errType,
          status: "active",
          questionId: qId,
          timestamp: Date.now(),
          retryHistory: [],
          aiConfirmation: false,
        };
        if (existingErrIdx >= 0) {
          // Append to retry history
          topic.errorRecords[existingErrIdx].retryHistory.push({
            timestamp: Date.now(),
            isCorrect: false,
            attemptNumber: topic.errorRecords[existingErrIdx].retryHistory.length + 1,
          });
          errorInfo = {
            errorType: errType,
            retryCount: topic.errorRecords[existingErrIdx].retryHistory.length,
            previousErrors: topic.errorRecords[existingErrIdx].retryHistory.length,
          };
        } else {
          topic.errorRecords.push(errRec);
          errorInfo = {
            errorType: errType,
            retryCount: 0,
            previousErrors: 0,
          };
        }
      }

      // ── Spaced Repetition (Feature 5) ──
      if (!topic.srState) {
        topic.srState = initSRState(topic.type);
      }
      topic.srState = scheduleNextSR(topic.srState, topic.type, isCorrect);

      // ── LearningStage transitions (Feature 6) ──
      const prevStage = topic.stage;
      if (isCorrect) {
        switch (topic.stage) {
          case "diagnostic":
            topic.stage = "practice";
            break;
          case "explain":
            // Agent should have called mastery_update to advance to feynman_check
            // If somehow grade is called on explain stage, move to practice
            topic.stage = "practice";
            break;
          case "feynman_check":
            // Should not get here — feynman_check uses mastery_assess
            topic.stage = "practice";
            break;
          case "error_diagnosis":
            topic.stage = "practice";
            break;
          // practice stays practice unless mastered
        }
      } else {
        // Wrong answer
        switch (topic.stage) {
          case "diagnostic":
            topic.stage = "explain";
            break;
          case "practice":
            topic.stage = "error_diagnosis";
            break;
          case "error_diagnosis":
            // Stay in error_diagnosis — track failure
            topic.stageFailureCounts["error_diagnosis"] = (topic.stageFailureCounts["error_diagnosis"] ?? 0) + 1;
            topic.stageFailureNotes["error_diagnosis"] = `Wrong again after error diagnosis on "${topic.topic}"`;
            break;
        }
      }

      // Check for stage failure threshold (3+ failures at same stage)
      if (topic.stageFailureCounts["error_diagnosis"] >= 3) {
        topic.stageFailureNotes["graceful_degradation"] =
          `Topic "${topic.topic}" has been stuck at error_diagnosis 3+ times. Consider moving on.`;
      }

      // ── Mastery computation ──
      const score = computeMastery(topic.attempts);
      const mastered = isMastered(topic);

      if (mastered) {
        topic.stage = "completed";
        topic.status = "completed";
      } else if (topic.stage === "practice") {
        // After practice, check if 2+ consecutive correct → suggest review readiness
        const recentCorrect = topic.attempts.slice(-3).filter(a => a.isCorrect).length;
        if (recentCorrect >= 3 && topic.type !== "concept" && topic.type !== "design") {
          // Learner is doing well in practice
        }
      }

      await writeMastery(kbPath, data);

      const next = nextTopicAfterUpdate(data);
      const neededForGate = mastered ? 0 : Math.max(0, 3 - topic.attempts.filter((a) => a.isCorrect).length);
      const consecutiveCorrect = (() => {
        let count = 0;
        for (let i = topic.attempts.length - 1; i >= 0; i--) {
          if (topic.attempts[i].isCorrect) count++;
          else break;
        }
        return count;
      })();
      const stageActions: Record<string, string> = {
        diagnostic: "Pose an initial diagnostic question with mastery_quiz.",
        explain: "Explain the concept to the learner, then use mastery_update to advance to feynman_check.",
        feynman_check: "Ask the learner to explain in their own words, then call mastery_assess.",
        practice: "Pose another practice question with mastery_quiz.",
        error_diagnosis: "Diagnose why the learner got it wrong and provide targeted remediation, then use mastery_update to set stage back to practice.",
        review: "Pose a spaced-repetition review question.",
        completed: "Topic is mastered. Move to the next topic.",
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            isCorrect,
            topic: topic.topic,
            stage: topic.stage,
            masteryScore: Math.round(score * 100) / 100,
            threshold: MASTERY_THRESHOLD,
            mastered,
            attempts: topic.attempts.length,
            consecutiveCorrect,
            needsMoreAttempts: neededForGate > 0 ? `Need ${neededForGate} more correct answers to reach mastery` : null,
            // Error info (Feature 3)
            errorInfo: errorInfo ? {
              errorType: errorInfo.errorType,
              classification: errorInfo.errorType === "metacognitive"
                ? "Blank/no answer — learner may not know where to start"
                : "Application error — learner attempted but got it wrong",
              retryCount: errorInfo.retryCount,
              instruction: errorInfo.errorType === "metacognitive"
                ? "Guide the learner through the first step rather than asking for a full answer."
                : "Review the concept and provide a similar but different practice question.",
            } : null,
            // Stage info (Feature 6)
            stageFailureWarning: topic.stageFailureCounts["error_diagnosis"] >= 3
              ? "This topic has been stuck at error_diagnosis multiple times. Consider graceful degradation."
              : null,
            stageInstruction: stageActions[topic.stage] ?? "Continue working on this topic.",
            // SRS info (Feature 5)
            nextReviewAt: topic.srState?.nextReviewAt
              ? new Date(topic.srState.nextReviewAt).toISOString()
              : null,
            // Next topic
            nextTopic: next
              ? { topic: next.topic, type: next.type, stage: next.stage, difficulty: next.difficulty, description: next.description }
              : (mastered ? null : { topic: topic.topic, note: "Keep practicing — mastery gate not yet cleared" }),
            instruction: isCorrect
              ? (mastered
                ? `Correct! ${topic.topic} is now MASTERED (${Math.round(score * 100)}%). Moving on.`
                : `Correct! But mastery is ${Math.round(score * 100)}% — gate requires ≥${MASTERY_THRESHOLD * 100}%. ${neededForGate > 0 ? `Need ${neededForGate} more correct answers (confidence cap prevents early mastery).` : ""}`)
              : `Incorrect. Expected: "${topic.pendingQuestion?.expectedAnswer ?? "(unknown)"}". ${stageActions[topic.stage] ?? "Encourage the learner and try another question."}`,
          }, null, 2),
        }],
        details: {
          isCorrect,
          mastered,
          stage: topic.stage,
          masteryScore: score,
          nextTopic: next?.topic ?? null,
          errorType: errorInfo?.errorType ?? null,
        },
      };
    },
  });

  // ═══ mastery_update (updated: supports stage and all new statuses) ═══
  pi.registerTool({
    name: "mastery_update",
    label: "Update Topic Status (Manual)",
    description:
      "Manually update topic status or stage. Use this for CONCEPT/DESIGN topics after a Feynman-style explanation check (call mastery_assess instead). For MEMORY/PROCEDURE topics, prefer mastery_quiz + mastery_grade for deterministic gate enforcement. Also use this to manually advance stages (e.g., after explaining a concept, set stage to feynman_check). Valid stages: diagnostic, explain, feynman_check, practice, error_diagnosis, review, completed.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      topic: Type.String({ description: "Topic name to update" }),
      status: Type.Optional(Type.String({
        description: "Legacy status: not_started, in_progress, or completed",
      })),
      stage: Type.Optional(Type.String({
        description: "Learning stage: diagnostic, explain, feynman_check, practice, error_diagnosis, review, completed",
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      const data = await readMastery(kbPath);

      if (!data) {
        return {
          content: [{ type: "text", text: `No learning path found for "${params.kb_name}". Use mastery_generate first.` }],
          details: { success: false },
        };
      }

      const topic = findTopic(data, params.topic);
      if (!topic) {
        return {
          content: [{ type: "text", text: `Topic "${params.topic}" not found.` }],
          details: { success: false },
        };
      }

      // Validate and apply stage
      if (params.stage !== undefined) {
        const validStages = ["diagnostic", "explain", "feynman_check", "practice", "error_diagnosis", "review", "completed"];
        if (!validStages.includes(params.stage)) {
          return {
            content: [{ type: "text", text: `Invalid stage "${params.stage}". Must be: ${validStages.join(", ")}` }],
            details: { success: false },
          };
        }
        topic.stage = params.stage as LearningStage;
        // Sync legacy status
        if (params.stage === "completed") topic.status = "completed";
        else if (params.stage === "diagnostic") topic.status = "not_started";
        else topic.status = "in_progress";
      }

      // Validate and apply legacy status
      if (params.status !== undefined) {
        const validStatuses = ["not_started", "in_progress", "completed"];
        if (!validStatuses.includes(params.status)) {
          return {
            content: [{ type: "text", text: `Invalid status "${params.status}". Must be: ${validStatuses.join(", ")}` }],
            details: { success: false },
          };
        }
        topic.status = params.status as LegacyStatus;
        // Sync stage
        if (params.status === "completed") topic.stage = "completed";
        else if (params.status === "not_started") topic.stage = "diagnostic";
      }

      if (params.stage === undefined && params.status === undefined) {
        return {
          content: [{ type: "text", text: "Provide either 'status' or 'stage' (or both) to update." }],
          details: { success: false },
        };
      }

      await writeMastery(kbPath, data);

      const next = nextTopicAfterUpdate(data);
      const score = getDisplayMastery(topic);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            topic: topic.topic,
            type: topic.type,
            stage: topic.stage,
            status: topic.status,
            masteryScore: Math.round(score * 100) / 100,
            mastered: isMastered(topic),
            nextTopic: next
              ? { topic: next.topic, type: next.type, stage: next.stage, difficulty: next.difficulty, description: next.description }
              : null,
          }, null, 2),
        }],
        details: { success: true, nextTopic: next?.topic ?? null },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // FEATURE 1 + 4: mastery_status
  // ═══════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "mastery_status",
    label: "Mastery Status & Next Action",
    description:
      "ALWAYS call this tool FIRST on every turn. Returns the learning path status, what to do next, and a map summary. Priority: 1) answer pending question → 2) due review items → 3) first unmastered topic (prerequisites met) → 4) path complete. The mapSummary includes per-topic status, overall mastery percent, and per-module breakdown.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      session_id: Type.Optional(Type.String({ description: "Optional session identifier for continuity" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      const data = await readMastery(kbPath);

      if (!data) {
        return {
          content: [{ type: "text", text: JSON.stringify({
            action: "generate",
            reason: "No learning path found. Use mastery_generate or mastery_build to create one.",
            mapSummary: { totalTopics: 0, masteredTopics: 0, learningTopics: 0, newTopics: 0, masteryPercent: 0, modules: [] },
            overdueReviews: [],
          }, null, 2) }],
          details: { action: "generate" },
        };
      }

      // 1. Check pending question
      const pendingTopic = data.path.find((t) => t.pendingQuestion !== null);
      if (pendingTopic) {
        const mapSummary = buildMapSummary(data);
        return {
          content: [{ type: "text", text: JSON.stringify({
            action: "answer_pending",
            topic: {
              topic: pendingTopic.topic,
              type: pendingTopic.type,
              stage: pendingTopic.stage,
              status: objectiveStatus(pendingTopic),
              masteryScore: getDisplayMastery(pendingTopic),
              difficulty: pendingTopic.difficulty,
              description: pendingTopic.description,
              prerequisites: pendingTopic.prerequisites,
            },
            pendingQuestion: {
              questionId: pendingTopic.pendingQuestion!.questionId,
              question: pendingTopic.pendingQuestion!.question,
              questionType: pendingTopic.pendingQuestion!.questionType,
              options: pendingTopic.pendingQuestion!.options,
            },
            mapSummary,
            overdueReviews: [],
            reason: "A question is awaiting the learner's answer. Grade it with mastery_grade.",
          }, null, 2) }],
          details: { action: "answer_pending", topic: pendingTopic.topic },
        };
      }

      // 2. Check due reviews
      const dueReviews = getDueReviews(data);
      if (dueReviews.length > 0) {
        const mapSummary = buildMapSummary(data);
        const reviewTopic = data.path.find((t) => t.topic === dueReviews[0].knowledgePointId);
        return {
          content: [{ type: "text", text: JSON.stringify({
            action: "review",
            topic: reviewTopic ? {
              topic: reviewTopic.topic,
              type: reviewTopic.type,
              stage: reviewTopic.stage,
              status: objectiveStatus(reviewTopic),
              masteryScore: getDisplayMastery(reviewTopic),
              difficulty: reviewTopic.difficulty,
              description: reviewTopic.description,
              prerequisites: reviewTopic.prerequisites,
            } : undefined,
            mapSummary,
            overdueReviews: dueReviews.map((r) => ({
              knowledgePointId: r.knowledgePointId,
              knowledgeType: r.knowledgeType,
              dueAt: new Date(r.dueAt).toISOString(),
              priority: r.priority,
            })),
            reason: `${dueReviews.length} topic(s) due for spaced-repetition review. Highest-priority: "${dueReviews[0].knowledgePointId}".`,
          }, null, 2) }],
          details: { action: "review", reviewCount: dueReviews.length, firstReview: dueReviews[0].knowledgePointId },
        };
      }

      // 3. Find first unmastered topic with prerequisites met
      const next = nextTopicAfterUpdate(data);
      if (next) {
        const mapSummary = buildMapSummary(data);
        const status = objectiveStatus(next);
        const stageActions: Record<string, string> = {
          diagnostic: status === "new"
            ? "Probe the learner with a diagnostic question (mastery_quiz) or let them test out."
            : "Pose a question with mastery_quiz.",
          explain: "Explain the concept to the learner, then set stage to feynman_check with mastery_update.",
          feynman_check: "Ask the learner to explain in their own words, then call mastery_assess.",
          practice: "Pose a practice question with mastery_quiz.",
          error_diagnosis: "Diagnose the error and provide remediation, then set stage back to practice with mastery_update.",
          review: "Pose a review question.",
          completed: "Already mastered.",
        };
        const gateKind = getGateKind(next);
        return {
          content: [{ type: "text", text: JSON.stringify({
            action: status === "new" ? "probe" : (gateKind === "qualitative" ? "assess" : "practice"),
            topic: {
              topic: next.topic,
              type: next.type,
              stage: next.stage,
              status,
              masteryScore: getDisplayMastery(next),
              difficulty: next.difficulty,
              description: next.description,
              prerequisites: next.prerequisites,
            },
            mapSummary,
            overdueReviews: [],
            stageInstruction: stageActions[next.stage] ?? "Continue working on this topic.",
            gateInfo: gateKind === "qualitative"
              ? "This topic requires a Feynman-style explanation check (mastery_assess) rather than quiz grading."
              : "This topic requires ≥90% accuracy over multiple quiz attempts.",
            reason: `Next topic: "${next.topic}" (${next.stage}, ${gateKind} gate). ${stageActions[next.stage] ?? ""}`,
            stageFailureWarning: next.stageFailureCounts["error_diagnosis"] >= 3
              ? `Topic "${next.topic}" has been stuck at error_diagnosis 3+ times. Consider graceful degradation.`
              : null,
          }, null, 2) }],
          details: { action: status === "new" ? "probe" : (gateKind === "qualitative" ? "assess" : "practice"), topic: next.topic, stage: next.stage },
        };
      }

      // 4. All mastered
      const mapSummary = buildMapSummary(data);
      return {
        content: [{ type: "text", text: JSON.stringify({
          action: "complete",
          mapSummary,
          overdueReviews: [],
          reason: "All topics are mastered and no reviews are due. The learning path is complete!",
        }, null, 2) }],
        details: { action: "complete" },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // FEATURE 2: mastery_assess (Feynman check for concept/design)
  // ═══════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "mastery_assess",
    label: "Feynman Assessment (Concept/Design)",
    description:
      "Qualitative gate for CONCEPT and DESIGN topics. Instead of quiz questions, the learner explains the topic in their own words (Feynman check). If the explanation is correct and complete, set passed=true to mark the topic as mastered. If incomplete, set passed=false to provide feedback and increment retry count. Will reject MEMORY and PROCEDURE topics — use mastery_quiz+mastery_grade for those.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      topic: Type.String({ description: "Topic name to assess" }),
      passed: Type.Boolean({ description: "true if the learner's Feynman explanation is correct and complete, false otherwise" }),
      feedback: Type.Optional(Type.String({ description: "Feedback or guidance if the explanation was incomplete" })),
      evidence: Type.Optional(Type.String({ description: "The learner's explanation text (stored as feynmanExplanation)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      const data = await readMastery(kbPath);

      if (!data) {
        return {
          content: [{ type: "text", text: `No learning path found for "${params.kb_name}". Use mastery_generate first.` }],
          details: { success: false },
        };
      }

      const topic = findTopic(data, params.topic);
      if (!topic) {
        return {
          content: [{ type: "text", text: `Topic "${params.topic}" not found.` }],
          details: { success: false },
        };
      }

      // Only concept and design topics
      if (topic.type !== "concept" && topic.type !== "design") {
        return {
          content: [{
            type: "text",
            text: `"${topic.topic}" is a ${topic.type} topic. mastery_assess only works for CONCEPT and DESIGN topics. Use mastery_quiz + mastery_grade for ${topic.type} topics.`,
          }],
          details: { success: false, reason: "Wrong topic type for Feynman assessment" },
        };
      }

      if (params.passed) {
        // Mark as completed
        topic.stage = "completed";
        topic.status = "completed";
        topic.feynmanExplanation = params.evidence ?? topic.feynmanExplanation;
        // Initialize SRS for review scheduling
        if (!topic.srState) {
          topic.srState = initSRState(topic.type);
        }
      } else {
        // Increment retry count, store feedback
        topic.feynmanRetries += 1;
        if (params.evidence) {
          topic.feynmanExplanation = params.evidence;
        }
        // Move back to explain stage for reteaching
        topic.stage = "explain";
        // Track stage failure
        topic.stageFailureCounts["feynman_check"] = (topic.stageFailureCounts["feynman_check"] ?? 0) + 1;
        if (params.feedback) {
          topic.stageFailureNotes[`feynman_fail_${topic.feynmanRetries}`] = params.feedback;
        }
      }

      await writeMastery(kbPath, data);

      const next = nextTopicAfterUpdate(data);
      const score = getDisplayMastery(topic);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            topic: topic.topic,
            type: topic.type,
            stage: topic.stage,
            passed: params.passed,
            feynmanRetries: topic.feynmanRetries,
            masteryScore: Math.round(score * 100) / 100,
            mastered: isMastered(topic),
            feedback: params.feedback ?? null,
            nextTopic: next
              ? { topic: next.topic, type: next.type, stage: next.stage, difficulty: next.difficulty, description: next.description }
              : null,
            instruction: params.passed
              ? `Feynman check PASSED for "${topic.topic}". Moving on.`
              : `Feynman check NOT YET PASSED for "${topic.topic}". Retry #${topic.feynmanRetries}. ${params.feedback ? `Feedback: ${params.feedback}` : ""} Re-explain the concept and try again.`,
            gracefulDegradation: topic.stageFailureCounts["feynman_check"] >= 3
              ? `Topic "${topic.topic}" has failed Feynman check 3+ times. Consider accepting a partial understanding or breaking it into smaller subtopics.`
              : null,
          }, null, 2),
        }],
        details: { success: true, passed: params.passed, nextTopic: next?.topic ?? null },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // FEATURE 7: mastery_build
  // ═══════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "mastery_build",
    label: "Build Learning Path from KB Analysis",
    description:
      "Build a structured learning path directly from KB analysis, organized into modules with knowledge points. Each knowledge point needs a name, type (memory/procedure/concept/design), and prerequisites (referencing other KP by name). IDs are auto-generated. Mode 'replace' overwrites the entire path; 'append' adds new modules/KPs to an existing path. After building, call mastery_status to find the first topic to work on.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      modules: Type.Array(Type.Object({
        name: Type.String({ description: "Module name (e.g. 'Linear Algebra Fundamentals')" }),
        order: Type.Number({ description: "Module order (1-based)" }),
        knowledgePoints: Type.Array(Type.Object({
          name: Type.String({ description: "Knowledge point name (e.g. 'Matrix Multiplication')" }),
          type: Type.String({ description: "Knowledge type: memory, procedure, concept, or design" }),
          prerequisites: Type.Array(Type.String(), { description: "Names of prerequisite knowledge points" }),
        })),
      })),
      mode: Type.Optional(Type.String({ description: "Either 'replace' (default) to overwrite, or 'append' to add to existing path" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      const mode = params.mode ?? "replace";

      // Validate KB exists
      try {
        await access(kbPath);
      } catch {
        return {
          content: [{ type: "text", text: `Knowledge base "${params.kb_name}" does not exist.` }],
          details: { success: false },
        };
      }

      const validTypes: KnowledgeType[] = ["memory", "procedure", "concept", "design"];

      // Collect all KP names for validation
      const allKpNames = new Set<string>();
      const kpToModule = new Map<string, string>();
      for (const mod of params.modules) {
        for (const kp of mod.knowledgePoints) {
          const id = nameToId(kp.name);
          allKpNames.add(kp.name.toLowerCase());
          kpToModule.set(kp.name.toLowerCase(), mod.name);
        }
      }

      // Validate types and prerequisites
      const errors: string[] = [];
      for (const mod of params.modules) {
        for (const kp of mod.knowledgePoints) {
          if (!validTypes.includes(kp.type as KnowledgeType)) {
            errors.push(`KP "${kp.name}": invalid type "${kp.type}". Must be memory, procedure, concept, or design.`);
          }
          for (const prereq of kp.prerequisites) {
            if (!allKpNames.has(prereq.toLowerCase())) {
              errors.push(`KP "${kp.name}": prerequisite "${prereq}" not found in any module.`);
            }
          }
        }
      }

      if (errors.length > 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, errors }, null, 2) }],
          details: { success: false, errorCount: errors.length },
        };
      }

      // Build topics
      const newTopics: MasteryTopic[] = [];
      const modules: KModule[] = [];

      for (const mod of params.modules) {
        const kpNames: string[] = [];
        for (const kp of mod.knowledgePoints) {
          const uniqueName = kp.name; // Use original name for uniqueness
          kpNames.push(uniqueName);
          newTopics.push({
            topic: uniqueName,
            prerequisites: kp.prerequisites,
            difficulty: 2, // default difficulty
            status: "not_started" as LegacyStatus,
            description: `Part of module: ${mod.name}`,
            type: validTypes.includes(kp.type as KnowledgeType) ? (kp.type as KnowledgeType) : "memory",
            attempts: [],
            pendingQuestion: null,
            stage: "diagnostic" as LearningStage,
            feynmanRetries: 0,
            feynmanExplanation: "",
            errorRecords: [],
            srState: null,
            stageFailureCounts: {},
            stageFailureNotes: {},
            diagnosticPassed: false,
            diagnosticTimestamp: 0,
          });
        }
        modules.push({
          name: mod.name,
          order: mod.order,
          knowledgePoints: kpNames,
        });
      }

      // Read existing data if appending
      let existingData: MasteryData | null = null;
      if (mode === "append") {
        existingData = await readMastery(kbPath);
      }

      const data: MasteryData = {
        kbName: params.kb_name,
        generatedAt: new Date().toISOString(),
        path: mode === "append" && existingData
          ? [...existingData.path, ...newTopics]
          : newTopics,
        modules: mode === "append" && existingData?.modules
          ? [...existingData.modules, ...modules]
          : modules,
        moduleNames: mode === "append" && existingData?.moduleNames
          ? [...existingData.moduleNames, ...params.modules.map((m) => m.name)]
          : params.modules.map((m) => m.name),
      };

      await writeMastery(kbPath, data);

      const summary = {
        success: true,
        kbName: params.kb_name,
        mode,
        topicCount: data.path.length,
        moduleCount: data.modules.length,
        generatedAt: data.generatedAt,
        modules: params.modules.map((m) => ({
          name: m.name,
          order: m.order,
          knowledgePoints: m.knowledgePoints.map((kp) => ({
            name: kp.name,
            type: kp.type,
            prerequisites: kp.prerequisites,
          })),
        })),
        nextStep: "Call mastery_status to find the first topic to work on.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        details: { success: true, topicCount: data.path.length, moduleCount: data.modules.length },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // FEATURE 8: mastery_diagnostic
  // ═══════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "mastery_diagnostic",
    label: "Diagnostic Pre-Test",
    description:
      "Record results of a diagnostic pre-test. Topics the learner passes get an initial mastery boost (0.7 score bypassing the confidence cap for the first quiz). Topics the learner fails are marked for learning from scratch. The agent should: 1) scan KB topics, 2) ask 1-2 quick diagnostic questions per module, 3) call this tool with the results, 4) call mastery_status to find the first unmastered topic.",
    parameters: Type.Object({
      kb_name: Type.String({ description: "Knowledge base name" }),
      results: Type.Array(Type.Object({
        knowledgePointId: Type.String({ description: "Knowledge point name/topic ID" }),
        passed: Type.Boolean({ description: "true if the learner answered correctly" }),
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const kbPath = join(config.rootDir, params.kb_name);
      const data = await readMastery(kbPath);

      if (!data) {
        return {
          content: [{ type: "text", text: `No learning path found for "${params.kb_name}". Use mastery_generate or mastery_build first.` }],
          details: { success: false },
        };
      }

      const passed: string[] = [];
      const willLearn: string[] = [];
      let skipped = 0;

      for (const result of params.results) {
        const topic = findTopic(data, result.knowledgePointId);
        if (!topic) {
          skipped++;
          continue;
        }

        if (result.passed) {
          // Mark diagnostic as passed — inject fake correct attempts to boost initial mastery
          topic.diagnosticPassed = true;
          topic.diagnosticTimestamp = Date.now();
          // Add 2 "ghost" correct attempts to give initial mastery of ~0.7
          // (bypasses the confidence cap because it acts as if learner already knows)
          topic.attempts.push(
            { timestamp: Date.now() - 60000, isCorrect: true, userAnswer: "(diagnostic-pass)" },
            { timestamp: Date.now() - 30000, isCorrect: true, userAnswer: "(diagnostic-pass)" }
          );
          topic.stage = "practice";
          topic.status = "in_progress";
          passed.push(topic.topic);
        } else {
          // Mark as not started — will learn from scratch
          topic.diagnosticPassed = false;
          topic.diagnosticTimestamp = Date.now();
          topic.stage = "diagnostic";
          topic.status = "not_started";
          willLearn.push(topic.topic);
        }
      }

      await writeMastery(kbPath, data);

      const mapSummary = buildMapSummary(data);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            total: params.results.length,
            passed: passed.length,
            skipped,
            willLearn: willLearn.length,
            passedTopics: passed,
            willLearnTopics: willLearn,
            mapSummary,
            instruction: passed.length > 0
              ? `${passed.length} topic(s) passed diagnostic — initial mastery boosted to ~70%. Learners can test out.`
              : "No topics passed diagnostic. All will be learned from scratch.",
            nextStep: "Call mastery_status to find the first topic to work on.",
          }, null, 2),
        }],
        details: {
          success: true,
          total: params.results.length,
          passed: passed.length,
          willLearn: willLearn.length,
        },
      };
    },
  });
}
