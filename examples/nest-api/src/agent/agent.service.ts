import { Injectable, Logger } from "@nestjs/common";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { AgentSessionService } from "@kibadist/agentui-nest";
import { runAgentLoop } from "@kibadist/agentui-ai";
import { describeComponents, type ComponentDef } from "@kibadist/agentui-validate";
import type { ActionEvent, UIEvent } from "@kibadist/agentui-protocol";
import { ClinicDB } from "../db/clinic-db.js";
import { createClinicTools } from "../db/clinic-tools.js";

/**
 * Healthcare component schemas — the allowed UI vocabulary. Mirrors the
 * frontend registry in `next-app/components/schemas.ts`; keep the two in sync.
 * `describeComponents` turns these into the system prompt's component catalog.
 */
const COMPONENT_DEFS: Record<string, ComponentDef> = {
  "text-block": {
    propsSchema: z.object({
      title: z.string().optional().describe("heading"),
      body: z.string().describe("markdown or plain text — good for summaries"),
    }),
  },
  "patient-card": {
    propsSchema: z.object({
      name: z.string(),
      mrn: z.string().describe("medical record number"),
      age: z.number(),
      sex: z.string(),
      condition: z.string().describe("primary condition"),
      status: z.enum(["active", "inactive"]),
    }),
  },
  "patient-list": {
    propsSchema: z.object({
      title: z.string().optional(),
      patients: z
        .array(
          z.object({
            name: z.string(),
            mrn: z.string(),
            age: z.number(),
            condition: z.string(),
            status: z.enum(["active", "inactive"]),
          }),
        )
        .describe("rows are clickable — clicking emits a patient.view action"),
    }),
  },
  "vitals-panel": {
    propsSchema: z.object({
      patientName: z.string(),
      recordedAt: z.string().describe("ISO datetime of the reading"),
      heartRate: z.number().describe("bpm"),
      systolic: z.number().describe("mmHg"),
      diastolic: z.number().describe("mmHg"),
      tempC: z.number().describe("Celsius"),
      spo2: z.number().describe("percent"),
    }),
  },
  "medication-list": {
    propsSchema: z.object({
      title: z.string().optional(),
      medications: z.array(
        z.object({
          name: z.string(),
          dose: z.string(),
          frequency: z.string(),
          startedOn: z.string(),
        }),
      ),
    }),
  },
  "appointment-list": {
    propsSchema: z.object({
      title: z.string().optional(),
      appointments: z.array(
        z.object({
          patientName: z.string(),
          mrn: z.string(),
          scheduledFor: z.string().describe("ISO datetime"),
          reason: z.string(),
          provider: z.string(),
          status: z.enum(["scheduled", "completed", "cancelled"]),
        }),
      ),
    }),
  },
};

const ALLOWED_TYPES = Object.keys(COMPONENT_DEFS);

const SYSTEM_PROMPT = `You are a clinical front-desk assistant for a small clinic. You help staff look up patients, vitals, medications, and appointments.

You have READ-ONLY database tools — call them to fetch real data, never invent patients or values:
- list_patients: the full roster
- get_patient(mrn): one patient's full record
- search_patients(condition?, status?): filter the roster
- get_appointments(when?): appointments for today / this week / all
- abnormal_vitals: patients whose latest vitals are out of range

After fetching data, render it with the emit_ui_event tool. Each component needs a unique "key".

Render guidelines:
- A roster or any multi-patient result → "patient-list" (its rows are clickable).
- One patient in focus → "patient-card", then "vitals-panel" and/or "medication-list" as relevant.
- Appointment queries → "appointment-list".
- Use "text-block" for a short natural-language summary, and op "ui.toast" for brief notifications.
- Pass vitals as raw numbers to "vitals-panel"; the UI flags out-of-range values itself.

Component types and props:

${describeComponents(COMPONENT_DEFS)}

Be concise. Always respond with UI components, not just text.`;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly sessionService = new AgentSessionService();
  private readonly db = new ClinicDB();
  private model: LanguageModel | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const anthropic = createAnthropic({ apiKey });
      this.model = anthropic("claude-sonnet-4-6");
      this.logger.log("Anthropic model initialized");
    } else {
      this.logger.warn(
        "ANTHROPIC_API_KEY not set – using DB-backed mock responses",
      );
    }
    this.sessionService.startCleanup();
  }

  /** Welcome toast on a fresh session. */
  async handleSessionCreated(sessionId: string): Promise<void> {
    this.emit(sessionId, {
      op: "ui.toast",
      level: "info",
      message: "Connected to the clinic. Ask about patients, vitals, or appointments.",
    });
  }

  /** Run the agent (or mock) when a user action arrives. */
  async handleAction(sessionId: string, action: ActionEvent): Promise<void> {
    // A clicked patient-list row drills into one patient.
    if (action.name === "patient.view") {
      const mrn = action.payload?.["mrn"] as string | undefined;
      if (mrn) {
        this.mockPatientDetail(sessionId, mrn);
        return;
      }
    }

    const userMessage =
      (action.payload?.["message"] as string | undefined) ??
      `User performed action: ${action.name}`;

    if (!this.model) {
      this.mockResponse(sessionId, userMessage);
      return;
    }

    try {
      await runAgentLoop({
        model: this.model,
        system: SYSTEM_PROMPT,
        prompt: userMessage,
        allowedTypes: [...ALLOWED_TYPES],
        sessionId,
        extraTools: createClinicTools(this.db),
        onUIEvent: (event) => this.sessionService.emitUI(sessionId, event),
      });
    } catch (err) {
      this.logger.error("Agent loop error", err);
      this.emit(sessionId, {
        op: "ui.toast",
        level: "error",
        message: `Agent error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  /** Build + emit a UIEvent, filling in the envelope fields. */
  private emit(sessionId: string, partial: Record<string, unknown>): void {
    this.sessionService.emitUI(sessionId, {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      ...partial,
    } as UIEvent);
  }

  private append(sessionId: string, key: string, type: string, props: unknown): void {
    this.emit(sessionId, { op: "ui.append", node: { key, type, props } });
  }

  // ---- DB-backed mock backend (no API key) -------------------------------
  // Keyword-routes the user's message to a DB query and emits components,
  // so the example is fully usable offline.

  private mockResponse(sessionId: string, message: string): void {
    const text = message.toLowerCase();
    const mrnMatch = message.match(/MRN-\d{4}/i);

    if (mrnMatch) {
      this.mockPatientDetail(sessionId, mrnMatch[0].toUpperCase());
      return;
    }
    if (text.includes("appointment")) {
      const when = text.includes("today") ? "today" : text.includes("week") ? "week" : "all";
      this.mockAppointments(sessionId, when);
      return;
    }
    if (text.includes("abnormal") || text.includes("vitals") || text.includes("flag")) {
      this.mockAbnormal(sessionId);
      return;
    }
    if (text.includes("diabet") || text.includes("asthma") || text.includes("hypertens")) {
      const condition = text.includes("diabet")
        ? "diabetes"
        : text.includes("asthma")
          ? "asthma"
          : "hypertension";
      this.mockRoster(sessionId, this.db.searchPatients({ condition }), `Patients with ${condition}`);
      return;
    }
    // default: full roster
    this.mockRoster(sessionId, this.db.listPatients(), "All patients");
  }

  private mockRoster(sessionId: string, patients: ReturnType<ClinicDB["listPatients"]>, title: string): void {
    this.append(sessionId, `roster-${Date.now()}`, "patient-list", {
      title,
      patients: patients.map((p) => ({
        name: p.name,
        mrn: p.mrn,
        age: ageOf(p.dob),
        condition: p.primary_condition,
        status: p.status,
      })),
    });
  }

  private mockPatientDetail(sessionId: string, mrn: string): void {
    const detail = this.db.getPatient(mrn);
    if (!detail) {
      this.emit(sessionId, { op: "ui.toast", level: "warning", message: `No patient with MRN ${mrn}` });
      return;
    }
    const stamp = Date.now();
    this.append(sessionId, `pc-${mrn}-${stamp}`, "patient-card", {
      name: detail.name,
      mrn: detail.mrn,
      age: detail.age,
      sex: detail.sex,
      condition: detail.primary_condition,
      status: detail.status,
    });
    if (detail.latest_vitals) {
      const v = detail.latest_vitals;
      this.append(sessionId, `vp-${mrn}-${stamp}`, "vitals-panel", {
        patientName: detail.name,
        recordedAt: v.recorded_at,
        heartRate: v.heart_rate,
        systolic: v.systolic,
        diastolic: v.diastolic,
        tempC: v.temp_c,
        spo2: v.spo2,
      });
    }
    if (detail.medications.length) {
      this.append(sessionId, `ml-${mrn}-${stamp}`, "medication-list", {
        title: `${detail.name} — medications`,
        medications: detail.medications.map((m) => ({
          name: m.name,
          dose: m.dose,
          frequency: m.frequency,
          startedOn: m.started_on,
        })),
      });
    }
  }

  private mockAppointments(sessionId: string, when: "today" | "week" | "all"): void {
    const appts = this.db.getAppointments(when);
    const label = when === "today" ? "Today's appointments" : when === "week" ? "This week's appointments" : "All appointments";
    if (!appts.length) {
      this.emit(sessionId, { op: "ui.toast", level: "info", message: `No ${label.toLowerCase()}.` });
      return;
    }
    this.append(sessionId, `appts-${Date.now()}`, "appointment-list", {
      title: label,
      appointments: appts.map((a) => ({
        patientName: a.patient_name,
        mrn: a.mrn,
        scheduledFor: a.scheduled_for,
        reason: a.reason,
        provider: a.provider,
        status: a.status,
      })),
    });
  }

  private mockAbnormal(sessionId: string): void {
    const flagged = this.db.patientsWithAbnormalVitals();
    if (!flagged.length) {
      this.emit(sessionId, { op: "ui.toast", level: "success", message: "All patients' latest vitals are within range." });
      return;
    }
    const stamp = Date.now();
    this.append(sessionId, `abn-text-${stamp}`, "text-block", {
      title: "Patients with abnormal vitals",
      body: flagged.map((f) => `- **${f.patient.name}** (${f.patient.mrn}): ${f.flags.join(", ")}`).join("\n"),
    });
    for (const f of flagged) {
      this.append(sessionId, `abn-vp-${f.patient.mrn}-${stamp}`, "vitals-panel", {
        patientName: f.patient.name,
        recordedAt: f.vitals.recorded_at,
        heartRate: f.vitals.heart_rate,
        systolic: f.vitals.systolic,
        diastolic: f.vitals.diastolic,
        tempC: f.vitals.temp_c,
        spo2: f.vitals.spo2,
      });
    }
  }
}

function ageOf(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}
