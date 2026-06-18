import Database from "better-sqlite3";

/**
 * In-memory SQLite database for the AgentUI agent-observability example.
 *
 * Seeded fresh on construction with three recorded agent runs. Each run carries
 * the data needed to drive the SVG observability components: a workflow graph
 * (steps + branch edges), a tool timeline (the same steps as time-ordered
 * items), a state machine (states + transitions with an active state), a memory
 * graph (memory nodes linked to a single `output` node), and an optional review
 * checkpoint. Nothing is persisted — restart for a clean slate.
 */

export interface Run {
  id: number;
  slug: string;
  task: string;
  status: string;
  active_state: string | null;
  checkpoint_json: string | null;
}

export interface Step {
  id: number;
  run_id: number;
  ord: number;
  step_key: string;
  label: string;
  sublabel: string | null;
  tool: string | null;
  status: string;
  duration_ms: number | null;
  detail: string | null;
}

export interface Edge {
  id: number;
  run_id: number;
  from_key: string;
  to_key: string;
  label: string | null;
}

export interface Memory {
  id: number;
  run_id: number;
  mem_key: string;
  label: string;
  mem_type: string; // preference | project | source | rule | output
  strength: number;
}

export interface State {
  id: number;
  run_id: number;
  ord: number;
  state_key: string;
  label: string;
  status: string;
}

export interface Transition {
  id: number;
  run_id: number;
  from_key: string;
  to_key: string;
  label: string | null;
}

/** A run shaped for the SVG observability components. */
export interface RunDetail {
  slug: string;
  task: string;
  status: string;
  workflow: {
    nodes: { id: string; label: string; sublabel?: string; status?: string }[];
    edges: { id: string; from: string; to: string; label?: string; status?: string }[];
  };
  timeline: {
    items: { id: string; label: string; status?: string; durationMs?: number; detail?: string }[];
  };
  machine: {
    states: { id: string; label: string; status?: string }[];
    transitions: { id: string; from: string; to: string; label?: string }[];
    active?: string;
  };
  memory: {
    nodes: { id: string; label: string; type: string; strength?: number }[];
    links: { id: string; from: string; to: string; strength?: number }[];
  };
  checkpoint?: { title: string; description?: string; level?: string; summary?: string };
}

interface Checkpoint {
  title: string;
  description?: string;
  level?: string;
  summary?: string;
}

const SCHEMA_SQL = `
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  active_state TEXT,
  checkpoint_json TEXT
);
CREATE TABLE steps (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  ord INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  sublabel TEXT,
  tool TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  detail TEXT
);
CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  label TEXT
);
CREATE TABLE memory (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  mem_key TEXT NOT NULL,
  label TEXT NOT NULL,
  mem_type TEXT NOT NULL,
  strength REAL NOT NULL
);
CREATE TABLE states (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  ord INTEGER NOT NULL,
  state_key TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE transitions (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  label TEXT
);
`;

interface SeedRun {
  slug: string;
  task: string;
  status: string;
  active_state: string;
  checkpoint?: Checkpoint;
  steps: Omit<Step, "id" | "run_id">[];
  edges: Omit<Edge, "id" | "run_id">[];
  memory: Omit<Memory, "id" | "run_id">[];
  states: Omit<State, "id" | "run_id">[];
  transitions: Omit<Transition, "id" | "run_id">[];
}

const RUNS: SeedRun[] = [
  {
    slug: "deploy-investigation",
    task: "Investigate the failing production deploy",
    status: "blocked",
    active_state: "awaiting_review",
    checkpoint: {
      title: "Roll back release v2.4.1?",
      level: "high",
      description: "The failing health checks trace to v2.4.1. Rolling back restores the last green build.",
      summary: "3 of 4 canary pods crash-looping · error rate 12% · root cause: migration 0042 left an orphaned column.",
    },
    steps: [
      { ord: 1, step_key: "pull-logs", label: "Pull deploy logs", sublabel: "last 30m", tool: "get_run", status: "success", duration_ms: 820, detail: "Fetched 4 pods of logs; 3 show CrashLoopBackOff after migration 0042." },
      { ord: 2, step_key: "diff-release", label: "Diff release v2.4.1", sublabel: "vs v2.4.0", tool: "git_diff", status: "success", duration_ms: 1340, detail: "Migration 0042 drops a column still referenced by the orders read path." },
      { ord: 3, step_key: "repro-staging", label: "Reproduce on staging", sublabel: "canary slice", tool: "run_query", status: "success", duration_ms: 4200, detail: "Reproduced the 500s on staging within 12s of boot." },
      { ord: 4, step_key: "check-metrics", label: "Check error metrics", sublabel: "prometheus", tool: "run_query", status: "failed", duration_ms: 2600, detail: "Error rate held at 12%; metrics endpoint timed out twice before responding." },
      { ord: 5, step_key: "draft-rollback", label: "Draft rollback plan", sublabel: "needs approval", tool: "get_run", status: "waiting", duration_ms: null, detail: "Rollback to v2.4.0 prepared; blocked on human approval at the review checkpoint." },
      { ord: 6, step_key: "notify-oncall", label: "Notify on-call", sublabel: "skipped", tool: null, status: "skipped", duration_ms: null, detail: "Skipped — on-call already paged by the alerting pipeline." },
    ],
    edges: [
      { from_key: "pull-logs", to_key: "diff-release", label: null },
      { from_key: "diff-release", to_key: "repro-staging", label: null },
      { from_key: "repro-staging", to_key: "check-metrics", label: "confirm" },
      { from_key: "repro-staging", to_key: "draft-rollback", label: "branch: mitigate" },
      { from_key: "check-metrics", to_key: "draft-rollback", label: null },
      { from_key: "draft-rollback", to_key: "notify-oncall", label: null },
    ],
    memory: [
      { mem_key: "pref-rollback", label: "Prefer rollback over hotfix on Fridays", mem_type: "preference", strength: 0.9 },
      { mem_key: "proj-deploy", label: "Project: payments-api", mem_type: "project", strength: 0.8 },
      { mem_key: "src-runbook", label: "Source: deploy runbook §rollback", mem_type: "source", strength: 0.7 },
      { mem_key: "rule-canary", label: "Rule: never roll forward a crash-looping canary", mem_type: "rule", strength: 0.95 },
      { mem_key: "out-finding", label: "Finding: migration 0042 is the root cause", mem_type: "output", strength: 1 },
    ],
    states: [
      { ord: 1, state_key: "triage", label: "Triage", status: "success" },
      { ord: 2, state_key: "investigate", label: "Investigate", status: "success" },
      { ord: 3, state_key: "reproduce", label: "Reproduce", status: "success" },
      { ord: 4, state_key: "awaiting_review", label: "Awaiting review", status: "running" },
      { ord: 5, state_key: "resolved", label: "Resolved", status: "idle" },
    ],
    transitions: [
      { from_key: "triage", to_key: "investigate", label: "logs pulled" },
      { from_key: "investigate", to_key: "reproduce", label: "cause found" },
      { from_key: "reproduce", to_key: "awaiting_review", label: "rollback drafted" },
      { from_key: "awaiting_review", to_key: "resolved", label: "approved" },
      { from_key: "awaiting_review", to_key: "investigate", label: "rejected" },
    ],
  },
  {
    slug: "intake-summary",
    task: "Summarize the new patient intake",
    status: "running",
    active_state: "summarizing",
    steps: [
      { ord: 1, step_key: "load-intake", label: "Load intake form", sublabel: "PDF", tool: "get_run", status: "success", duration_ms: 540, detail: "Parsed a 6-page intake form into structured fields." },
      { ord: 2, step_key: "extract-history", label: "Extract history", sublabel: "meds + conditions", tool: "run_query", status: "success", duration_ms: 1880, detail: "Found 2 chronic conditions and 3 active medications." },
      { ord: 3, step_key: "check-allergies", label: "Cross-check allergies", sublabel: "drug interactions", tool: "run_query", status: "success", duration_ms: 1120, detail: "No interactions between listed medications and noted allergies." },
      { ord: 4, step_key: "summarize", label: "Write summary", sublabel: "in progress", tool: "get_run", status: "running", duration_ms: null, detail: "Drafting a one-paragraph clinical summary for the front desk." },
      { ord: 5, step_key: "flag-followups", label: "Flag follow-ups", sublabel: "pending", tool: null, status: "skipped", duration_ms: null, detail: "Deferred until the summary draft is complete." },
    ],
    edges: [
      { from_key: "load-intake", to_key: "extract-history", label: null },
      { from_key: "extract-history", to_key: "check-allergies", label: "verify" },
      { from_key: "extract-history", to_key: "summarize", label: "branch: draft" },
      { from_key: "check-allergies", to_key: "summarize", label: null },
      { from_key: "summarize", to_key: "flag-followups", label: null },
    ],
    memory: [
      { mem_key: "pref-tone", label: "Prefer concise clinical tone", mem_type: "preference", strength: 0.7 },
      { mem_key: "proj-intake", label: "Project: front-desk assistant", mem_type: "project", strength: 0.75 },
      { mem_key: "src-form", label: "Source: intake form v3", mem_type: "source", strength: 0.85 },
      { mem_key: "rule-phi", label: "Rule: never expose full PHI in summaries", mem_type: "rule", strength: 0.95 },
      { mem_key: "out-summary", label: "Output: intake summary draft", mem_type: "output", strength: 1 },
    ],
    states: [
      { ord: 1, state_key: "loading", label: "Loading", status: "success" },
      { ord: 2, state_key: "extracting", label: "Extracting", status: "success" },
      { ord: 3, state_key: "verifying", label: "Verifying", status: "success" },
      { ord: 4, state_key: "summarizing", label: "Summarizing", status: "running" },
      { ord: 5, state_key: "done", label: "Done", status: "idle" },
    ],
    transitions: [
      { from_key: "loading", to_key: "extracting", label: "parsed" },
      { from_key: "extracting", to_key: "verifying", label: "history ready" },
      { from_key: "verifying", to_key: "summarizing", label: "clean" },
      { from_key: "summarizing", to_key: "done", label: "drafted" },
      { from_key: "verifying", to_key: "extracting", label: "gap found" },
    ],
  },
  {
    slug: "competitor-research",
    task: "Research competitor pricing tiers",
    status: "success",
    active_state: "complete",
    steps: [
      { ord: 1, step_key: "list-targets", label: "List competitors", sublabel: "5 targets", tool: "list_runs", status: "success", duration_ms: 410, detail: "Identified 5 direct competitors to compare pricing against." },
      { ord: 2, step_key: "fetch-pricing", label: "Fetch pricing pages", sublabel: "5 sites", tool: "run_query", status: "success", duration_ms: 6300, detail: "Scraped public pricing pages for all 5 competitors." },
      { ord: 3, step_key: "parse-tiers", label: "Parse tiers", sublabel: "normalize", tool: "run_query", status: "success", duration_ms: 2100, detail: "Normalized 17 plans into Free / Pro / Enterprise tiers." },
      { ord: 4, step_key: "fetch-reviews", label: "Fetch review sentiment", sublabel: "rate-limited", tool: "run_query", status: "failed", duration_ms: 3400, detail: "Review API returned 429; sentiment enrichment skipped for this run." },
      { ord: 5, step_key: "build-matrix", label: "Build comparison matrix", sublabel: "tiers × price", tool: "get_run", status: "success", duration_ms: 980, detail: "Assembled a 5×3 price matrix with feature deltas highlighted." },
      { ord: 6, step_key: "write-brief", label: "Write brief", sublabel: "final", tool: "get_run", status: "success", duration_ms: 1500, detail: "Produced a one-page positioning brief with two pricing recommendations." },
    ],
    edges: [
      { from_key: "list-targets", to_key: "fetch-pricing", label: null },
      { from_key: "fetch-pricing", to_key: "parse-tiers", label: null },
      { from_key: "parse-tiers", to_key: "fetch-reviews", label: "branch: enrich" },
      { from_key: "parse-tiers", to_key: "build-matrix", label: "branch: core" },
      { from_key: "fetch-reviews", to_key: "build-matrix", label: "merge" },
      { from_key: "build-matrix", to_key: "write-brief", label: null },
    ],
    memory: [
      { mem_key: "pref-tables", label: "Prefer tables over prose for comparisons", mem_type: "preference", strength: 0.6 },
      { mem_key: "proj-pricing", label: "Project: 2026 pricing refresh", mem_type: "project", strength: 0.8 },
      { mem_key: "src-pages", label: "Source: competitor pricing pages", mem_type: "source", strength: 0.9 },
      { mem_key: "src-reviews", label: "Source: review aggregator API", mem_type: "source", strength: 0.4 },
      { mem_key: "rule-public", label: "Rule: cite only public pricing data", mem_type: "rule", strength: 0.85 },
      { mem_key: "out-brief", label: "Output: pricing positioning brief", mem_type: "output", strength: 1 },
    ],
    states: [
      { ord: 1, state_key: "scoping", label: "Scoping", status: "success" },
      { ord: 2, state_key: "collecting", label: "Collecting", status: "success" },
      { ord: 3, state_key: "analyzing", label: "Analyzing", status: "success" },
      { ord: 4, state_key: "drafting", label: "Drafting", status: "success" },
      { ord: 5, state_key: "complete", label: "Complete", status: "success" },
    ],
    transitions: [
      { from_key: "scoping", to_key: "collecting", label: "targets set" },
      { from_key: "collecting", to_key: "analyzing", label: "pages fetched" },
      { from_key: "analyzing", to_key: "drafting", label: "matrix built" },
      { from_key: "drafting", to_key: "complete", label: "brief done" },
      { from_key: "collecting", to_key: "collecting", label: "retry on 429" },
    ],
  },
];

export class AgentDB {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(":memory:");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.seed();
  }

  private seed(): void {
    const insertRun = this.db.prepare(
      `INSERT INTO runs (slug, task, status, active_state, checkpoint_json)
       VALUES (@slug, @task, @status, @active_state, @checkpoint_json)`,
    );
    const insertStep = this.db.prepare(
      `INSERT INTO steps (run_id, ord, step_key, label, sublabel, tool, status, duration_ms, detail)
       VALUES (@run_id, @ord, @step_key, @label, @sublabel, @tool, @status, @duration_ms, @detail)`,
    );
    const insertEdge = this.db.prepare(
      `INSERT INTO edges (run_id, from_key, to_key, label)
       VALUES (@run_id, @from_key, @to_key, @label)`,
    );
    const insertMemory = this.db.prepare(
      `INSERT INTO memory (run_id, mem_key, label, mem_type, strength)
       VALUES (@run_id, @mem_key, @label, @mem_type, @strength)`,
    );
    const insertState = this.db.prepare(
      `INSERT INTO states (run_id, ord, state_key, label, status)
       VALUES (@run_id, @ord, @state_key, @label, @status)`,
    );
    const insertTransition = this.db.prepare(
      `INSERT INTO transitions (run_id, from_key, to_key, label)
       VALUES (@run_id, @from_key, @to_key, @label)`,
    );

    for (const run of RUNS) {
      const info = insertRun.run({
        slug: run.slug,
        task: run.task,
        status: run.status,
        active_state: run.active_state,
        checkpoint_json: run.checkpoint ? JSON.stringify(run.checkpoint) : null,
      });
      const runId = Number(info.lastInsertRowid);
      for (const s of run.steps) insertStep.run({ run_id: runId, ...s });
      for (const e of run.edges) insertEdge.run({ run_id: runId, ...e });
      for (const m of run.memory) insertMemory.run({ run_id: runId, ...m });
      for (const st of run.states) insertState.run({ run_id: runId, ...st });
      for (const t of run.transitions) insertTransition.run({ run_id: runId, ...t });
    }
  }

  /** All runs, minimal shape, ordered by id. */
  listRuns(): { slug: string; task: string; status: string }[] {
    return this.db
      .prepare(`SELECT slug, task, status FROM runs ORDER BY id`)
      .all() as { slug: string; task: string; status: string }[];
  }

  /** Full run shaped for the observability components, or null if not found. */
  getRun(slug: string): RunDetail | null {
    const run = this.db.prepare(`SELECT * FROM runs WHERE slug = ?`).get(slug) as Run | undefined;
    if (!run) return null;

    const steps = this.db
      .prepare(`SELECT * FROM steps WHERE run_id = ? ORDER BY ord`)
      .all(run.id) as Step[];
    const edges = this.db
      .prepare(`SELECT * FROM edges WHERE run_id = ? ORDER BY id`)
      .all(run.id) as Edge[];
    const memory = this.db
      .prepare(`SELECT * FROM memory WHERE run_id = ? ORDER BY id`)
      .all(run.id) as Memory[];
    const states = this.db
      .prepare(`SELECT * FROM states WHERE run_id = ? ORDER BY ord`)
      .all(run.id) as State[];
    const transitions = this.db
      .prepare(`SELECT * FROM transitions WHERE run_id = ? ORDER BY id`)
      .all(run.id) as Transition[];

    const output = memory.find((m) => m.mem_type === "output");

    return {
      slug: run.slug,
      task: run.task,
      status: run.status,
      workflow: {
        nodes: steps.map((s) => ({
          id: s.step_key,
          label: s.label,
          ...(s.sublabel ? { sublabel: s.sublabel } : {}),
          ...(s.status ? { status: s.status } : {}),
        })),
        edges: edges.map((e) => ({
          id: `e-${e.id}`,
          from: e.from_key,
          to: e.to_key,
          ...(e.label ? { label: e.label } : {}),
        })),
      },
      timeline: {
        items: steps.map((s) => ({
          id: s.step_key,
          label: s.label,
          ...(s.status ? { status: s.status } : {}),
          ...(s.duration_ms != null ? { durationMs: s.duration_ms } : {}),
          ...(s.detail ? { detail: s.detail } : {}),
        })),
      },
      machine: {
        states: states.map((s) => ({
          id: s.state_key,
          label: s.label,
          ...(s.status ? { status: s.status } : {}),
        })),
        transitions: transitions.map((t) => ({
          id: `t-${t.id}`,
          from: t.from_key,
          to: t.to_key,
          ...(t.label ? { label: t.label } : {}),
        })),
        ...(run.active_state ? { active: run.active_state } : {}),
      },
      memory: {
        nodes: memory.map((m) => ({
          id: m.mem_key,
          label: m.label,
          type: m.mem_type,
          strength: m.strength,
        })),
        links: output
          ? memory
              .filter((m) => m.mem_type !== "output")
              .map((m) => ({
                id: `l-${m.id}`,
                from: m.mem_key,
                to: output.mem_key,
                strength: m.strength,
              }))
          : [],
      },
      ...(run.checkpoint_json ? { checkpoint: JSON.parse(run.checkpoint_json) as Checkpoint } : {}),
    };
  }

  /** Detail text (or label fallback) for a workflow node / timeline item. */
  stepDetail(slug: string, stepKey: string): string | null {
    const run = this.db.prepare(`SELECT id FROM runs WHERE slug = ?`).get(slug) as
      | { id: number }
      | undefined;
    if (!run) return null;
    const step = this.db
      .prepare(`SELECT label, detail FROM steps WHERE run_id = ? AND step_key = ?`)
      .get(run.id, stepKey) as { label: string; detail: string | null } | undefined;
    if (!step) return null;
    return step.detail ?? step.label;
  }

  /** Detail text (label) for a memory node. */
  memoryDetail(slug: string, memKey: string): string | null {
    const run = this.db.prepare(`SELECT id FROM runs WHERE slug = ?`).get(slug) as
      | { id: number }
      | undefined;
    if (!run) return null;
    const mem = this.db
      .prepare(`SELECT label FROM memory WHERE run_id = ? AND mem_key = ?`)
      .get(run.id, memKey) as { label: string } | undefined;
    return mem?.label ?? null;
  }
}
