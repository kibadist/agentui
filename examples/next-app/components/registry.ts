import { createRegistry } from "@kibadist/agentui-react";
import { TextBlock } from "./text-block";
import { PatientCard } from "./patient-card";
import { PatientList } from "./patient-list";
import { VitalsPanel } from "./vitals-panel";
import { MedicationList } from "./medication-list";
import { AppointmentList } from "./appointment-list";
import {
  textBlockSchema,
  patientCardSchema,
  patientListSchema,
  vitalsPanelSchema,
  medicationListSchema,
  appointmentListSchema,
} from "./schemas";

export const registry = createRegistry({
  "text-block": { component: TextBlock, propsSchema: textBlockSchema },
  "patient-card": { component: PatientCard, propsSchema: patientCardSchema },
  "patient-list": { component: PatientList, propsSchema: patientListSchema },
  "vitals-panel": { component: VitalsPanel, propsSchema: vitalsPanelSchema },
  "medication-list": { component: MedicationList, propsSchema: medicationListSchema },
  "appointment-list": { component: AppointmentList, propsSchema: appointmentListSchema },
});
