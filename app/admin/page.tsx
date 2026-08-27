"use client";

import { useEffect, useState } from "react";
import type { RpaRunSummary, PipelineRunSummary, ReviewAuditEntry, AgentHeartbeat } from "@/lib/db";

type Summary = {
  rpaRuns: RpaRunSummary[];
  pipelineRuns: PipelineRunSummary[];
  reviewActions: ReviewAuditEntry[];
  agentHeartbeats: AgentHeartbeat[];
};

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function minsAgo(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((Date.now() - d.getTime()) / 60000);
}

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  const bg = ok === null ? "var(--ignore-tint)" : ok ? "var(--add-tint)" : "var(--cancel-tint)";
  const fg = ok === null ? "var(--ignore)" : ok ? "var(--add)" : "var(--cancel)";
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</h2>
      <div
        className="rounded-md overflow-auto"
        style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", maxHeight: 360 }}
      >
        {children}
      </div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-3 py-1.5 text-xs font-medium sticky top-0"
      style={{ color: "var(--label)", background: "var(--paper-raised)", borderBottom: "1px solid var(--rule)" }}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td
      className={`tabular px-3 py-1.5 text-xs${className ? ` ${className}` : ""}`}
      style={{ color: "var(--ink)", borderBottom: "1px solid var(--rule)" }}
    >
      {children}
    </td>
  );
}

export default function AdminPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    fetch("/api/admin/summary")
      .then(async (res) => {
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setSummary(data);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (forbidden) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm" style={{ color: "var(--label)" }}>
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm" style={{ color: "var(--cancel)" }}>{error}</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm" style={{ color: "var(--label)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Admin — System Log</h1>
        <p className="text-xs" style={{ color: "var(--label)" }}>
          Read-only. RPA runs, ingest pipeline health, reviewer audit trail, agent heartbeat.
        </p>
      </header>

      <Section title="Agent heartbeat (VPS)">
        <table className="w-full">
          <thead>
            <tr><Th>Key</Th><Th>Value</Th><Th>Updated</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {summary.agentHeartbeats.map((h) => {
              const ago = minsAgo(h.updated_at);
              const stale = ago === null || ago > 15;
              return (
                <tr key={h.key}>
                  <Td>{h.key}</Td>
                  <Td>{h.value}</Td>
                  <Td>{fmtDateTime(h.updated_at)}{ago !== null && ` (${ago}m ago)`}</Td>
                  <Td><StatusPill ok={!stale} label={stale ? "Stale" : "Alive"} /></Td>
                </tr>
              );
            })}
            {summary.agentHeartbeats.length === 0 && (
              <tr><Td>No heartbeat rows found.</Td><Td></Td><Td></Td><Td></Td></tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Ingest / pipeline runs">
        <table className="w-full">
          <thead>
            <tr><Th>Run at</Th><Th>Subject</Th><Th>Client</Th><Th>Status</Th><Th>Jobs (written/skipped/failed)</Th><Th>Error</Th></tr>
          </thead>
          <tbody>
            {summary.pipelineRuns.map((p, i) => (
              <tr key={i}>
                <Td>{fmtDateTime(p.run_at)}</Td>
                <Td className="max-w-[240px] truncate">{p.email_subject}</Td>
                <Td>{p.client_name}</Td>
                <Td><StatusPill ok={p.status === "SUCCESS" ? true : p.status === "PARTIAL" ? null : false} label={p.status} /></Td>
                <Td>{p.jobs_written}/{p.jobs_skipped}/{p.jobs_failed}</Td>
                <Td className="max-w-[200px] truncate">{p.error}</Td>
              </tr>
            ))}
            {summary.pipelineRuns.length === 0 && (
              <tr><Td>No pipeline runs found.</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="RPA runs (Client Portal)">
        <table className="w-full">
          <thead>
            <tr><Th>Run at</Th><Th>Job</Th><Th>Client</Th><Th>Status</Th><Th>Failed step</Th><Th>Duration</Th><Th>Error</Th></tr>
          </thead>
          <tbody>
            {summary.rpaRuns.map((r, i) => (
              <tr key={i}>
                <Td>{fmtDateTime(r.run_at)}</Td>
                <Td>{r.job_number}</Td>
                <Td>{r.client_name}</Td>
                <Td><StatusPill ok={r.success} label={r.status || (r.success ? "SUCCESS" : "FAIL")} /></Td>
                <Td>{r.failed_step}</Td>
                <Td>{r.duration_ms !== null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</Td>
                <Td className="max-w-[200px] truncate">{r.error}</Td>
              </tr>
            ))}
            {summary.rpaRuns.length === 0 && (
              <tr><Td>No RPA runs found.</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Reviewer audit trail">
        <table className="w-full">
          <thead>
            <tr><Th>Job</Th><Th>Action</Th><Th>By</Th><Th>At</Th></tr>
          </thead>
          <tbody>
            {summary.reviewActions.map((r, i) => (
              <tr key={i}>
                <Td>{r.job_number}</Td>
                <Td>{r.review_action}</Td>
                <Td>{r.review_action_by}</Td>
                <Td>{fmtDateTime(r.review_action_at)}</Td>
              </tr>
            ))}
            {summary.reviewActions.length === 0 && (
              <tr><Td>No review actions found.</Td><Td></Td><Td></Td><Td></Td></tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
