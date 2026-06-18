// Sample data for the demo — edit freely to explore the components.
// Shapes match the exported TypeScript types in @kibadist/agentui-svg.

export const workflow = {
  nodes: [
    { id: "plan", label: "Planner", sublabel: "decompose task", status: "success" },
    { id: "search", label: "Web search", sublabel: "web.search", status: "success" },
    { id: "db", label: "DB query", sublabel: "patients.find", status: "running" },
    { id: "mem", label: "Memory", sublabel: "context recall", status: "idle" },
    { id: "review", label: "Approval", sublabel: "human gate", status: "waiting" },
    { id: "resp", label: "Response", sublabel: "compose reply", status: "idle" },
  ],
  edges: [
    { id: "e1", from: "plan", to: "search" },
    { id: "e2", from: "plan", to: "db" },
    { id: "e3", from: "search", to: "mem", label: "store" },
    { id: "e4", from: "db", to: "mem", label: "store" },
    { id: "e5", from: "mem", to: "review" },
    { id: "e6", from: "review", to: "resp", label: "approved" },
  ],
};

export const timeline = {
  items: [
    { id: "plan", label: "plan", status: "success", durationMs: 140, detail: "3 subtasks identified" },
    { id: "search", label: "web.search", status: "success", durationMs: 820, detail: "5 results, top 3 kept" },
    { id: "db", label: "patients.find", status: "running", durationMs: 0, detail: "querying SQLite…" },
    { id: "validate", label: "schema.validate", status: "skipped", detail: "no schema configured" },
    { id: "rate", label: "rate.limit", status: "blocked", detail: "waiting on quota" },
  ],
};

export const checkpoint = {
  title: "Send appointment reminders?",
  description: "This sends SMS to 24 patients immediately and cannot be undone.",
  level: "high",
  summary: "24 recipients · template: reminder-v3",
};

export const memory = {
  nodes: [
    { id: "pref-tone", label: "Tone: concise", type: "preference", group: "prefs" },
    { id: "pref-lang", label: "Lang: en-US", type: "preference", group: "prefs" },
    { id: "proj", label: "Clinic Q3", type: "project", group: "project" },
    { id: "src-spec", label: "intake.md", type: "source", group: "sources" },
    { id: "src-notes", label: "visit-notes.pdf", type: "source", group: "sources" },
    { id: "rule-hipaa", label: "No PII in logs", type: "rule", group: "rules" },
    { id: "out", label: "Draft reply", type: "output", group: "output" },
  ],
  links: [
    { id: "m1", from: "pref-tone", to: "out", strength: 0.5 },
    { id: "m2", from: "pref-lang", to: "out", strength: 0.4 },
    { id: "m3", from: "proj", to: "out", strength: 0.7 },
    { id: "m4", from: "src-spec", to: "out", strength: 0.9 },
    { id: "m5", from: "src-notes", to: "out", strength: 0.85 },
    { id: "m6", from: "rule-hipaa", to: "out", strength: 0.6 },
  ],
};

export const machine = {
  states: [
    { id: "idle", label: "Idle" },
    { id: "planning", label: "Planning" },
    { id: "running", label: "Running" },
    { id: "waiting", label: "Waiting", status: "waiting" },
    { id: "done", label: "Complete", status: "success" },
    { id: "error", label: "Failed", status: "failed" },
  ],
  transitions: [
    { id: "t1", from: "idle", to: "planning" },
    { id: "t2", from: "planning", to: "running" },
    { id: "t3", from: "running", to: "waiting", label: "approval" },
    { id: "t4", from: "waiting", to: "done" },
    { id: "t5", from: "running", to: "error", label: "throw" },
  ],
  active: "running",
};
