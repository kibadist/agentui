import { z } from "zod";

/**
 * Prop schemas for the healthcare component registry. Mirrors the backend's
 * COMPONENT_DEFS in nest-api's agent.service.ts — keep the two in sync. These
 * give the renderer runtime prop validation (the security boundary), and the
 * agent only emits component types registered here.
 */

export const textBlockSchema = z.object({
  title: z.string().optional(),
  body: z.string(),
});

export const patientCardSchema = z.object({
  name: z.string(),
  mrn: z.string(),
  age: z.number(),
  sex: z.string(),
  condition: z.string(),
  status: z.string(),
});

export const patientListSchema = z.object({
  title: z.string().optional(),
  patients: z.array(
    z.object({
      name: z.string(),
      mrn: z.string(),
      age: z.number(),
      condition: z.string(),
      status: z.string(),
    }),
  ),
});

export const vitalsPanelSchema = z.object({
  patientName: z.string(),
  recordedAt: z.string(),
  heartRate: z.number(),
  systolic: z.number(),
  diastolic: z.number(),
  tempC: z.number(),
  spo2: z.number(),
});

export const medicationListSchema = z.object({
  title: z.string().optional(),
  medications: z.array(
    z.object({
      name: z.string(),
      dose: z.string(),
      frequency: z.string(),
      startedOn: z.string(),
    }),
  ),
});

export const appointmentListSchema = z.object({
  title: z.string().optional(),
  appointments: z.array(
    z.object({
      patientName: z.string(),
      mrn: z.string(),
      scheduledFor: z.string(),
      reason: z.string(),
      provider: z.string(),
      status: z.string(),
    }),
  ),
});
