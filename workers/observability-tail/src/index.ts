/**
 * Observability Tail Worker (BMC-168).
 *
 * A Tail Worker consumes the execution traces of the main OpenNext app Worker
 * (and the recommendations cron Worker) — see `tail_consumers` in their
 * wrangler configs. Because it runs as a separate service, it needs ZERO
 * changes to the generated `.open-next/worker.js`.
 *
 * On every producer invocation it inspects the trace for:
 *   - `outcome: "exception"` + `exceptions[]` — an uncaught throw / script error
 *   - `logs[]` lines carrying CRITICAL_MARKER — structured money-path failures
 *     emitted by `logCritical()` in `lib/utils/observe.ts`
 *
 * Any match is turned into an alert email via Resend, so a stuck order / failed
 * webhook pings a human within seconds instead of sitting silently in logs.
 *
 * Deploy separately, BEFORE the producers that reference it:
 *   wrangler deploy --env dev          # -> beauteas-observability-tail-dev
 *   wrangler deploy --env production   # -> beauteas-observability-tail
 * Secrets (per env): RESEND_API_KEY, ALERT_EMAIL_TO
 */

export interface Env {
  /** Resend API key (secret). */
  RESEND_API_KEY: string;
  /** Comma-separated recipient list (secret). */
  ALERT_EMAIL_TO: string;
  /** From address on a Resend-verified domain (var). */
  ALERT_EMAIL_FROM: string;
  /** "production" | "dev" — labels the alert (var). */
  ENVIRONMENT?: string;
}

/** Must match CRITICAL_MARKER in lib/utils/observe.ts. */
export const CRITICAL_MARKER = "[critical]";

/**
 * Cap emails per tail invocation so a retry storm (e.g. a webhook 500-looping)
 * can't flood the inbox from a single batch. Distinct signatures beyond this cap
 * are summarized in the "+N more" footer rather than sent individually.
 */
export const MAX_ALERTS_PER_INVOCATION = 5;

interface TailLog {
  message: unknown[];
  level: string;
  timestamp: number;
}

interface TailException {
  name: string;
  message: string;
  timestamp: number;
}

interface TailEvent {
  scriptName?: string;
  outcome: string;
  eventTimestamp?: number;
  event?: {
    request?: { url?: string; method?: string; cf?: { colo?: string } };
  };
  logs?: TailLog[];
  exceptions?: TailException[];
}

export interface Alert {
  kind: "exception" | "critical";
  title: string;
  script?: string;
  url?: string;
  colo?: string;
}

export default {
  async tail(events: TailEvent[], env: Env, ctx: ExecutionContext): Promise<void> {
    const alerts = extractAlerts(events);
    if (alerts.length === 0) return;

    const deduped = dedupe(alerts);
    // waitUntil: tail() returns void, so async work must be registered here.
    ctx.waitUntil(sendAlertEmail(deduped, env));
  },
};

/**
 * Classify a batch of traces into alerts: one per uncaught exception, and one
 * per log line carrying CRITICAL_MARKER. Pure (no I/O) so it is unit-testable.
 */
export function extractAlerts(events: TailEvent[]): Alert[] {
  const alerts: Alert[] = [];

  for (const ev of events) {
    // Bound the work, not just the email: in a retry storm a single batch could
    // carry thousands of failing invocations. Stop scanning well past the email
    // cap (dedupe + slice still trim to MAX_ALERTS_PER_INVOCATION downstream).
    if (alerts.length >= MAX_ALERTS_PER_INVOCATION * 10) break;

    const url = ev.event?.request?.url;
    const colo = ev.event?.request?.cf?.colo;

    // Uncaught exceptions: the Worker threw and the invocation failed.
    for (const ex of ev.exceptions ?? []) {
      alerts.push({
        kind: "exception",
        title: `${ex.name}: ${ex.message}`.slice(0, 300),
        script: ev.scriptName,
        url,
        colo,
      });
    }

    // Structured critical money-path logs from logCritical().
    for (const log of ev.logs ?? []) {
      const text = stringifyMessage(log.message);
      if (text.includes(CRITICAL_MARKER)) {
        alerts.push({
          kind: "critical",
          title: text.replace(CRITICAL_MARKER, "").trim().slice(0, 300),
          script: ev.scriptName,
          url,
          colo,
        });
      }
    }
  }

  return alerts;
}

/** Flatten a console.* message array into a single searchable string. */
export function stringifyMessage(message: unknown[]): string {
  if (!Array.isArray(message)) return String(message);
  return message
    .map((part) => (typeof part === "string" ? part : safeJson(part)))
    .join(" ");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Collapse identical alerts (by kind+title) so one fault = one line. */
export function dedupe(alerts: Alert[]): Alert[] {
  const seen = new Map<string, Alert>();
  for (const a of alerts) {
    const key = `${a.kind}:${a.title}`;
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

export async function sendAlertEmail(alerts: Alert[], env: Env): Promise<void> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO || !env.ALERT_EMAIL_FROM) {
    // Misconfigured alerter is itself a problem — log it (visible in this
    // Worker's own logs) but there's nowhere to send.
    console.error(
      "[observability-tail] cannot send alert: missing RESEND_API_KEY / ALERT_EMAIL_TO / ALERT_EMAIL_FROM"
    );
    return;
  }

  const envName = env.ENVIRONMENT ?? "unknown";
  const shown = alerts.slice(0, MAX_ALERTS_PER_INVOCATION);
  const overflow = alerts.length - shown.length;

  const subject = `🚨 [BeauTeas ${envName}] ${shown[0].title.slice(0, 90)}`;
  const html = renderHtml(shown, overflow, envName);
  const text = renderText(shown, overflow, envName);

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.ALERT_EMAIL_FROM,
        to: env.ALERT_EMAIL_TO.split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        html,
        text,
      }),
    });
  } catch (err) {
    console.error("[observability-tail] Resend request threw", err);
    return;
  }

  if (!res.ok) {
    console.error(`[observability-tail] Resend send failed HTTP ${res.status}: ${await res.text()}`);
  }
}

export function renderText(alerts: Alert[], overflow: number, envName: string): string {
  const lines = alerts.map(
    (a) =>
      `• [${a.kind}] ${a.title}` +
      (a.script ? `\n    script: ${a.script}` : "") +
      (a.url ? `\n    url: ${a.url}` : "") +
      (a.colo ? `\n    colo: ${a.colo}` : "")
  );
  if (overflow > 0) lines.push(`…and ${overflow} more distinct fault(s) this batch.`);
  return `BeauTeas production alert (${envName})\n\n${lines.join("\n\n")}`;
}

function renderHtml(alerts: Alert[], overflow: number, envName: string): string {
  const rows = alerts
    .map(
      (a) => `
      <div style="margin:0 0 16px;padding:12px 14px;border-left:4px solid #c0392b;background:#fbeae7">
        <div style="font-weight:600;color:#7b241c">[${escapeHtml(a.kind)}] ${escapeHtml(a.title)}</div>
        ${a.script ? `<div style="color:#555;font-size:13px">script: ${escapeHtml(a.script)}</div>` : ""}
        ${a.url ? `<div style="color:#555;font-size:13px">url: ${escapeHtml(a.url)}</div>` : ""}
        ${a.colo ? `<div style="color:#555;font-size:13px">colo: ${escapeHtml(a.colo)}</div>` : ""}
      </div>`
    )
    .join("");
  const footer =
    overflow > 0
      ? `<p style="color:#888;font-size:13px">…and ${overflow} more distinct fault(s) suppressed this batch.</p>`
      : "";
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:640px">
    <h2 style="color:#c0392b;margin:0 0 4px">🚨 BeauTeas alert — ${escapeHtml(envName)}</h2>
    <p style="color:#666;margin:0 0 16px;font-size:13px">A critical money-path failure was detected in Worker traces.</p>
    ${rows}${footer}
  </div>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
