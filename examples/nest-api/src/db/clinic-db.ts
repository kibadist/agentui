import Database from "better-sqlite3";

/**
 * In-memory SQLite clinic database for the AgentUI healthcare example.
 *
 * Seeded fresh on construction with five patients plus their vitals,
 * medications, and appointments. Appointment/vitals timestamps are anchored
 * to the server's current date so "today's appointments" stays meaningful
 * whenever you run the demo. Nothing is persisted — restart for a clean slate.
 */

export interface Patient {
  id: number;
  mrn: string;
  name: string;
  dob: string; // ISO date
  sex: "F" | "M";
  phone: string;
  primary_condition: string;
  status: "active" | "inactive";
}

export interface Vitals {
  id: number;
  patient_id: number;
  recorded_at: string; // ISO datetime
  heart_rate: number; // bpm
  systolic: number; // mmHg
  diastolic: number; // mmHg
  temp_c: number; // Celsius
  spo2: number; // %
}

export interface Medication {
  id: number;
  patient_id: number;
  name: string;
  dose: string;
  frequency: string;
  started_on: string; // ISO date
}

export interface Appointment {
  id: number;
  patient_id: number;
  scheduled_for: string; // ISO datetime
  reason: string;
  provider: string;
  status: "scheduled" | "completed" | "cancelled";
}

/** A patient joined with their related clinical records. */
export interface PatientDetail extends Patient {
  age: number;
  latest_vitals: Vitals | null;
  medications: Medication[];
  appointments: Appointment[];
}

const SCHEMA_SQL = `
CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  mrn TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  dob TEXT NOT NULL,
  sex TEXT NOT NULL,
  phone TEXT NOT NULL,
  primary_condition TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE vitals (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  recorded_at TEXT NOT NULL,
  heart_rate INTEGER NOT NULL,
  systolic INTEGER NOT NULL,
  diastolic INTEGER NOT NULL,
  temp_c REAL NOT NULL,
  spo2 INTEGER NOT NULL
);
CREATE TABLE medications (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  name TEXT NOT NULL,
  dose TEXT NOT NULL,
  frequency TEXT NOT NULL,
  started_on TEXT NOT NULL
);
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  scheduled_for TEXT NOT NULL,
  reason TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL
);
`;

/** Reference ranges used to flag abnormal vitals. */
export const VITALS_RANGES = {
  heart_rate: { min: 60, max: 100, label: "HR", unit: "bpm" },
  systolic: { min: 90, max: 130, label: "Systolic", unit: "mmHg" },
  diastolic: { min: 60, max: 85, label: "Diastolic", unit: "mmHg" },
  temp_c: { min: 36.1, max: 37.5, label: "Temp", unit: "°C" },
  spo2: { min: 95, max: 100, label: "SpO₂", unit: "%" },
} as const;

/** Returns the vitals metrics that fall outside their reference range. */
export function abnormalMetrics(v: Vitals): string[] {
  const out: string[] = [];
  for (const [key, range] of Object.entries(VITALS_RANGES)) {
    const value = v[key as keyof typeof VITALS_RANGES] as number;
    if (value < range.min || value > range.max) out.push(range.label);
  }
  return out;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoAt(base: Date, dayOffset: number, hour: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export class ClinicDB {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(":memory:");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.seed();
  }

  /** Compute age in whole years from an ISO date of birth. */
  private static age(dob: string): number {
    const birth = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  }

  private seed(): void {
    const today = new Date();

    const patients: Omit<Patient, "id">[] = [
      { mrn: "MRN-1001", name: "Margaret Chen", dob: "1958-03-12", sex: "F", phone: "555-0142", primary_condition: "Hypertension", status: "active" },
      { mrn: "MRN-1002", name: "James Okonkwo", dob: "1971-11-30", sex: "M", phone: "555-0188", primary_condition: "Type 2 Diabetes", status: "active" },
      { mrn: "MRN-1003", name: "Sofia Ramirez", dob: "1989-07-22", sex: "F", phone: "555-0119", primary_condition: "Asthma", status: "active" },
      { mrn: "MRN-1004", name: "David Thompson", dob: "1945-01-05", sex: "M", phone: "555-0173", primary_condition: "Atrial Fibrillation", status: "active" },
      { mrn: "MRN-1005", name: "Aisha Patel", dob: "2001-09-18", sex: "F", phone: "555-0156", primary_condition: "Migraine", status: "active" },
    ];

    const insertPatient = this.db.prepare(
      `INSERT INTO patients (mrn, name, dob, sex, phone, primary_condition, status)
       VALUES (@mrn, @name, @dob, @sex, @phone, @primary_condition, @status)`,
    );
    for (const p of patients) insertPatient.run(p);

    // latest vitals per patient — patient 1 & 4 have abnormal values
    const vitals: Omit<Vitals, "id">[] = [
      { patient_id: 1, recorded_at: isoAt(today, -1, 9), heart_rate: 78, systolic: 158, diastolic: 94, temp_c: 36.8, spo2: 97 },
      { patient_id: 2, recorded_at: isoAt(today, -2, 10), heart_rate: 82, systolic: 128, diastolic: 80, temp_c: 36.6, spo2: 98 },
      { patient_id: 3, recorded_at: isoAt(today, -1, 14), heart_rate: 88, systolic: 118, diastolic: 76, temp_c: 37.0, spo2: 96 },
      { patient_id: 4, recorded_at: isoAt(today, 0, 8), heart_rate: 112, systolic: 142, diastolic: 88, temp_c: 36.9, spo2: 93 },
      { patient_id: 5, recorded_at: isoAt(today, -3, 11), heart_rate: 72, systolic: 112, diastolic: 70, temp_c: 36.5, spo2: 99 },
    ];
    const insertVitals = this.db.prepare(
      `INSERT INTO vitals (patient_id, recorded_at, heart_rate, systolic, diastolic, temp_c, spo2)
       VALUES (@patient_id, @recorded_at, @heart_rate, @systolic, @diastolic, @temp_c, @spo2)`,
    );
    for (const v of vitals) insertVitals.run(v);

    const meds: Omit<Medication, "id">[] = [
      { patient_id: 1, name: "Lisinopril", dose: "10 mg", frequency: "once daily", started_on: "2021-04-02" },
      { patient_id: 1, name: "Amlodipine", dose: "5 mg", frequency: "once daily", started_on: "2023-01-15" },
      { patient_id: 2, name: "Metformin", dose: "1000 mg", frequency: "twice daily", started_on: "2019-09-10" },
      { patient_id: 2, name: "Empagliflozin", dose: "10 mg", frequency: "once daily", started_on: "2024-02-20" },
      { patient_id: 3, name: "Albuterol", dose: "90 mcg", frequency: "as needed", started_on: "2018-06-01" },
      { patient_id: 3, name: "Fluticasone", dose: "110 mcg", frequency: "twice daily", started_on: "2022-03-12" },
      { patient_id: 4, name: "Apixaban", dose: "5 mg", frequency: "twice daily", started_on: "2020-11-05" },
      { patient_id: 4, name: "Metoprolol", dose: "25 mg", frequency: "twice daily", started_on: "2020-11-05" },
      { patient_id: 5, name: "Sumatriptan", dose: "50 mg", frequency: "as needed", started_on: "2023-08-19" },
    ];
    const insertMed = this.db.prepare(
      `INSERT INTO medications (patient_id, name, dose, frequency, started_on)
       VALUES (@patient_id, @name, @dose, @frequency, @started_on)`,
    );
    for (const m of meds) insertMed.run(m);

    // appointments anchored around "today" so date filters stay relevant
    const appts: Omit<Appointment, "id">[] = [
      { patient_id: 1, scheduled_for: isoAt(today, 0, 9), reason: "Blood pressure follow-up", provider: "Dr. Nguyen", status: "scheduled" },
      { patient_id: 4, scheduled_for: isoAt(today, 0, 11), reason: "Anticoagulation review", provider: "Dr. Okafor", status: "scheduled" },
      { patient_id: 2, scheduled_for: isoAt(today, 1, 10), reason: "Diabetes check-in", provider: "Dr. Nguyen", status: "scheduled" },
      { patient_id: 3, scheduled_for: isoAt(today, 3, 14), reason: "Asthma action plan", provider: "Dr. Reyes", status: "scheduled" },
      { patient_id: 5, scheduled_for: isoAt(today, 6, 13), reason: "Migraine management", provider: "Dr. Reyes", status: "scheduled" },
      { patient_id: 2, scheduled_for: isoAt(today, -7, 10), reason: "Lab review", provider: "Dr. Nguyen", status: "completed" },
    ];
    const insertAppt = this.db.prepare(
      `INSERT INTO appointments (patient_id, scheduled_for, reason, provider, status)
       VALUES (@patient_id, @scheduled_for, @reason, @provider, @status)`,
    );
    for (const a of appts) insertAppt.run(a);
  }

  /** All patients, ordered by name. */
  listPatients(): Patient[] {
    return this.db.prepare(`SELECT * FROM patients ORDER BY name`).all() as Patient[];
  }

  /** Full record for one patient by MRN, or null if not found. */
  getPatient(mrn: string): PatientDetail | null {
    const patient = this.db
      .prepare(`SELECT * FROM patients WHERE mrn = ?`)
      .get(mrn) as Patient | undefined;
    if (!patient) return null;

    const latest_vitals =
      (this.db
        .prepare(
          `SELECT * FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 1`,
        )
        .get(patient.id) as Vitals | undefined) ?? null;

    const medications = this.db
      .prepare(`SELECT * FROM medications WHERE patient_id = ? ORDER BY started_on DESC`)
      .all(patient.id) as Medication[];

    const appointments = this.db
      .prepare(`SELECT * FROM appointments WHERE patient_id = ? ORDER BY scheduled_for`)
      .all(patient.id) as Appointment[];

    return {
      ...patient,
      age: ClinicDB.age(patient.dob),
      latest_vitals,
      medications,
      appointments,
    };
  }

  /** Filter patients by condition substring and/or status. */
  searchPatients(opts: { condition?: string; status?: string }): Patient[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (opts.condition) {
      clauses.push(`LOWER(primary_condition) LIKE @condition`);
      params.condition = `%${opts.condition.toLowerCase()}%`;
    }
    if (opts.status) {
      clauses.push(`status = @status`);
      params.status = opts.status;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM patients ${where} ORDER BY name`)
      .all(params) as Patient[];
  }

  /**
   * Appointments joined with patient name/MRN.
   * `when`: "today" (server's date), "week" (today .. +7d), or "all".
   */
  getAppointments(when: "today" | "week" | "all" = "all"): (Appointment & {
    patient_name: string;
    mrn: string;
  })[] {
    let where = "";
    const params: Record<string, string> = {};
    if (when !== "all") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + (when === "today" ? 1 : 7));
      where = `WHERE a.scheduled_for >= @start AND a.scheduled_for < @end`;
      params.start = start.toISOString();
      params.end = end.toISOString();
    }
    return this.db
      .prepare(
        `SELECT a.*, p.name AS patient_name, p.mrn AS mrn
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         ${where}
         ORDER BY a.scheduled_for`,
      )
      .all(params) as (Appointment & { patient_name: string; mrn: string })[];
  }

  /** Patients whose latest vitals fall outside reference ranges. */
  patientsWithAbnormalVitals(): { patient: Patient; vitals: Vitals; flags: string[] }[] {
    const out: { patient: Patient; vitals: Vitals; flags: string[] }[] = [];
    for (const patient of this.listPatients()) {
      const vitals = this.db
        .prepare(`SELECT * FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 1`)
        .get(patient.id) as Vitals | undefined;
      if (!vitals) continue;
      const flags = abnormalMetrics(vitals);
      if (flags.length > 0) out.push({ patient, vitals, flags });
    }
    return out;
  }
}
