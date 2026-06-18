import Database from "better-sqlite3";

/**
 * In-memory SQLite database for the AgentUI deploy/incident example.
 *
 * Models a small fleet of production services with their deploy history, error
 * logs, and metric series. Seeded fresh on construction with one recent BAD
 * deploy (checkout-service v2.4.1) whose error logs and metrics spike right
 * after it ships — the agent investigates this live by calling the read tools.
 *
 * All timestamps are relative to `now` so the demo stays current. Nothing is
 * persisted — restart for a clean slate.
 */

export interface Service {
  id: number;
  name: string;
  status: string; // healthy | degraded | down
  owner: string;
}

export interface Deploy {
  id: number;
  service: string;
  version: string;
  deployed_at: string; // ISO datetime
  author: string;
  healthy: number; // 1 | 0
}

export interface ErrorLog {
  id: number;
  service: string;
  ts: string; // ISO datetime
  level: string; // error | warn
  message: string;
  count: number;
}

export interface Metric {
  id: number;
  service: string;
  ts: string; // ISO datetime
  error_rate: number; // 0..1
  p99_ms: number;
  cpu: number; // 0..1
}

const SCHEMA_SQL = `
CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  owner TEXT NOT NULL
);
CREATE TABLE deploys (
  id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  version TEXT NOT NULL,
  deployed_at TEXT NOT NULL,
  author TEXT NOT NULL,
  healthy INTEGER NOT NULL
);
CREATE TABLE error_logs (
  id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  ts TEXT NOT NULL,
  error_rate REAL NOT NULL,
  p99_ms INTEGER NOT NULL,
  cpu REAL NOT NULL
);
`;

/** Minutes-ago ISO timestamp relative to `base`. */
function minsAgo(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60_000).toISOString();
}

/** Hours-ago ISO timestamp relative to `base`. */
function hoursAgo(base: Date, hours: number): string {
  return new Date(base.getTime() - hours * 3_600_000).toISOString();
}

export class AgentDB {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(":memory:");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.seed();
  }

  private seed(): void {
    const now = new Date();

    const services: Omit<Service, "id">[] = [
      { name: "checkout-service", status: "degraded", owner: "payments-team" },
      { name: "payments-api", status: "healthy", owner: "payments-team" },
      { name: "search-service", status: "healthy", owner: "discovery-team" },
      { name: "notifications", status: "healthy", owner: "growth-team" },
    ];
    const insertService = this.db.prepare(
      `INSERT INTO services (name, status, owner) VALUES (@name, @status, @owner)`,
    );
    for (const s of services) insertService.run(s);

    // Deploys. checkout-service v2.4.1 is the recent BAD deploy (healthy=0),
    // shipped ~20 min ago; v2.4.0 is its last good release.
    const deploys: Omit<Deploy, "id">[] = [
      { service: "checkout-service", version: "v2.3.9", deployed_at: hoursAgo(now, 26), author: "rao", healthy: 1 },
      { service: "checkout-service", version: "v2.4.0", deployed_at: hoursAgo(now, 8), author: "lin", healthy: 1 },
      { service: "checkout-service", version: "v2.4.1", deployed_at: minsAgo(now, 20), author: "okafor", healthy: 0 },
      { service: "payments-api", version: "v5.1.2", deployed_at: hoursAgo(now, 30), author: "rao", healthy: 1 },
      { service: "payments-api", version: "v5.1.3", deployed_at: hoursAgo(now, 5), author: "mendez", healthy: 1 },
      { service: "search-service", version: "v1.9.0", deployed_at: hoursAgo(now, 40), author: "park", healthy: 1 },
      { service: "search-service", version: "v1.9.1", deployed_at: hoursAgo(now, 12), author: "park", healthy: 1 },
      { service: "notifications", version: "v3.0.4", deployed_at: hoursAgo(now, 18), author: "iverson", healthy: 1 },
    ];
    const insertDeploy = this.db.prepare(
      `INSERT INTO deploys (service, version, deployed_at, author, healthy)
       VALUES (@service, @version, @deployed_at, @author, @healthy)`,
    );
    for (const d of deploys) insertDeploy.run(d);

    // Error logs. checkout-service spikes right after v2.4.1 (20m ago).
    const errorLogs: Omit<ErrorLog, "id">[] = [
      { service: "checkout-service", ts: minsAgo(now, 18), level: "error", message: "NullPointerException in CartTotalCalculator.apply()", count: 142 },
      { service: "checkout-service", ts: minsAgo(now, 14), level: "error", message: "500 on POST /checkout/confirm — downstream timeout", count: 88 },
      { service: "checkout-service", ts: minsAgo(now, 9), level: "error", message: "NullPointerException in CartTotalCalculator.apply()", count: 211 },
      { service: "checkout-service", ts: minsAgo(now, 3), level: "warn", message: "circuit breaker open for pricing-rpc", count: 17 },
      { service: "payments-api", ts: minsAgo(now, 40), level: "warn", message: "retry on transient 503 from bank-gateway", count: 4 },
      { service: "search-service", ts: hoursAgo(now, 6), level: "warn", message: "slow query: reindex lagging", count: 2 },
    ];
    const insertErrorLog = this.db.prepare(
      `INSERT INTO error_logs (service, ts, level, message, count)
       VALUES (@service, @ts, @level, @message, @count)`,
    );
    for (const e of errorLogs) insertErrorLog.run(e);

    // Metric series — a few points per service. checkout-service climbs after
    // the bad deploy (error_rate/p99/cpu all elevated in the latest points).
    const metrics: Omit<Metric, "id">[] = [
      { service: "checkout-service", ts: minsAgo(now, 30), error_rate: 0.004, p99_ms: 240, cpu: 0.35 },
      { service: "checkout-service", ts: minsAgo(now, 18), error_rate: 0.061, p99_ms: 910, cpu: 0.58 },
      { service: "checkout-service", ts: minsAgo(now, 9), error_rate: 0.118, p99_ms: 1480, cpu: 0.71 },
      { service: "checkout-service", ts: minsAgo(now, 2), error_rate: 0.124, p99_ms: 1610, cpu: 0.74 },
      { service: "payments-api", ts: minsAgo(now, 30), error_rate: 0.002, p99_ms: 180, cpu: 0.41 },
      { service: "payments-api", ts: minsAgo(now, 5), error_rate: 0.003, p99_ms: 195, cpu: 0.44 },
      { service: "search-service", ts: minsAgo(now, 30), error_rate: 0.001, p99_ms: 120, cpu: 0.30 },
      { service: "search-service", ts: minsAgo(now, 5), error_rate: 0.001, p99_ms: 132, cpu: 0.33 },
      { service: "notifications", ts: minsAgo(now, 30), error_rate: 0.000, p99_ms: 60, cpu: 0.18 },
      { service: "notifications", ts: minsAgo(now, 5), error_rate: 0.000, p99_ms: 64, cpu: 0.20 },
    ];
    const insertMetric = this.db.prepare(
      `INSERT INTO metrics (service, ts, error_rate, p99_ms, cpu)
       VALUES (@service, @ts, @error_rate, @p99_ms, @cpu)`,
    );
    for (const m of metrics) insertMetric.run(m);
  }

  /** All services with their current status, ordered by name. */
  listServices(): Service[] {
    return this.db.prepare(`SELECT * FROM services ORDER BY name`).all() as Service[];
  }

  /** Recent deploys, newest first. Optionally filtered to one service. */
  recentDeploys(service?: string, limit = 10): Deploy[] {
    if (service) {
      return this.db
        .prepare(`SELECT * FROM deploys WHERE service = ? ORDER BY deployed_at DESC LIMIT ?`)
        .all(service, limit) as Deploy[];
    }
    return this.db
      .prepare(`SELECT * FROM deploys ORDER BY deployed_at DESC LIMIT ?`)
      .all(limit) as Deploy[];
  }

  /** Error logs for a service, newest first, optionally since an ISO time. */
  errorLogs(service: string, sinceISO?: string): ErrorLog[] {
    if (sinceISO) {
      return this.db
        .prepare(`SELECT * FROM error_logs WHERE service = ? AND ts >= ? ORDER BY ts DESC`)
        .all(service, sinceISO) as ErrorLog[];
    }
    return this.db
      .prepare(`SELECT * FROM error_logs WHERE service = ? ORDER BY ts DESC`)
      .all(service) as ErrorLog[];
  }

  /** Metric series for a service, oldest first. */
  metrics(service: string): Metric[] {
    return this.db
      .prepare(`SELECT * FROM metrics WHERE service = ? ORDER BY ts`)
      .all(service) as Metric[];
  }

  /** Most recent healthy deploy for a service, or null. */
  lastGoodDeploy(service: string): Deploy | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM deploys WHERE service = ? AND healthy = 1 ORDER BY deployed_at DESC LIMIT 1`,
        )
        .get(service) as Deploy | undefined) ?? null
    );
  }
}
