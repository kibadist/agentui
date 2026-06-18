import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ClinicDB } from "./clinic-db.js";

/**
 * Read-only AI SDK tools over the clinic database. The agent calls these to
 * fetch data, then renders it with `emit_ui_event`. Passed to `runAgentLoop`
 * as `extraTools`.
 */
export function createClinicTools(db: ClinicDB): ToolSet {
  return {
    list_patients: tool({
      description:
        "List every patient in the clinic (name, MRN, age, primary condition, status). Use for roster/overview requests.",
      inputSchema: z.object({}),
      execute: async () => db.listPatients(),
    }),

    get_patient: tool({
      description:
        "Get one patient's full record by medical record number (MRN): demographics, latest vitals, medications, and appointments.",
      inputSchema: z.object({
        mrn: z.string().describe('Medical record number, e.g. "MRN-1003"'),
      }),
      execute: async ({ mrn }) => db.getPatient(mrn) ?? { error: `No patient with MRN ${mrn}` },
    }),

    search_patients: tool({
      description:
        "Find patients by primary condition (substring match) and/or status. Omit both to list all.",
      inputSchema: z.object({
        condition: z.string().optional().describe('e.g. "diabetes", "asthma"'),
        status: z.enum(["active", "inactive"]).optional(),
      }),
      execute: async ({ condition, status }) => db.searchPatients({ condition, status }),
    }),

    get_appointments: tool({
      description:
        "List appointments joined with patient name/MRN. `when` filters by date: today, this week, or all.",
      inputSchema: z.object({
        when: z.enum(["today", "week", "all"]).optional().describe("default: all"),
      }),
      execute: async ({ when }) => db.getAppointments(when ?? "all"),
    }),

    abnormal_vitals: tool({
      description:
        "List patients whose most recent vitals are outside reference ranges, with the flagged metrics.",
      inputSchema: z.object({}),
      execute: async () => db.patientsWithAbnormalVitals(),
    }),
  };
}
