"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { Manifest, ManifestJob, ManifestAction } from "@/lib/db";

const ACTIONS: { key: ManifestAction; hotkey: string; verb: string }[] = [
  { key: "Add", hotkey: "A", verb: "Add" },
  { key: "Update", hotkey: "U", verb: "Update" },
  { key: "Cancel", hotkey: "C", verb: "Cancel" },
  { key: "Ignore", hotkey: "I", verb: "Ignore" },
];

const ACTION_VARS: Record<ManifestAction, string> = {
  Add: "add",
  Update: "update",
  Cancel: "cancel",
  Ignore: "ignore",
};

type QueueItem = { manifest: Manifest; job: ManifestJob };

function buildQueue(manifests: Manifest[]): QueueItem[] {
  const items: QueueItem[] = [];
  for (const m of manifests) {
    for (const j of m.jobs) {
      if (!j.review_action) items.push({ manifest: m, job: j });
    }
  }
  return items;
}

/** delivery_date is stored as DD/MM/YYYY (UK format, matches DS Smith's own
 * booking form) — not natively Date.parse()-friendly, since JS assumes
 * MM/DD/YYYY or ISO. Returns null for empty/unparseable values. */
function parseUkDate(value: string): Date | null {
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterByDeliveryDate(items: QueueItem[], from: string, to: string): QueueItem[] {
  if (!from && !to) return items;
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  return items.filter(({ job }) => {
    const d = parseUkDate(job.delivery_date);
    if (!d) return false; // unparseable/missing delivery date — exclude when a filter is active
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
}

function ActionPill({ action, small }: { action: ManifestAction | ""; small?: boolean }) {
  if (!action) return null;
  const v = ACTION_VARS[action];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm font-bold tracking-wide uppercase ${small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"}`}
      style={{ background: `var(--${v}-tint)`, color: `var(--${v})` }}
    >
      {action}
    </span>
  );
}

function DiffField({ label, value, sub, changed }: { label: string; value: string; sub?: string; changed: boolean }) {
  return (
    <div
      className="rounded-sm px-3 py-2"
      style={{ background: changed ? "var(--update-tint)" : "var(--paper-raised)", border: `1px solid ${changed ? "var(--update)" : "var(--rule)"}` }}
    >
      <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: changed ? "var(--update)" : "var(--label)" }}>
        {label}
      </div>
      <div className="tabular text-sm font-semibold" style={{ color: "var(--ink)" }}>
        {value || <span style={{ color: "var(--label)" }}>—</span>}
      </div>
      {sub && <div className="tabular text-[11px] mt-0.5" style={{ color: "var(--label)" }}>{sub}</div>}
    </div>
  );
}

const CONFIDENCE_COLOR: Record<string, string> = {
  GREEN: "add",
  YELLOW: "update",
  RED: "cancel",
};

function ConfidenceBadge({ score, status }: { score: string; status: string }) {
  if (!status) return null;
  const v = CONFIDENCE_COLOR[status] ?? "ignore";
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-sm"
      style={{ background: `var(--${v}-tint)`, color: `var(--${v})` }}
      title="Extraction confidence"
    >
      {score ? `${score}%` : status}
    </span>
  );
}

function EmailBodyPanel({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1"
        style={{ color: "var(--label)" }}
      >
        <span className="tabular">{expanded ? "▾" : "▸"}</span> Email body
      </button>
      {expanded && (
        <div
          className="mt-2 rounded-sm px-3 py-2 text-xs whitespace-pre-wrap max-h-56 overflow-y-auto"
          style={{ background: "var(--paper-raised)", border: "1px solid var(--rule)", color: "var(--ink-soft)" }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

function JobFocus({
  item,
  onDecide,
  saving,
  queuePosition,
  queueTotal,
}: {
  item: QueueItem;
  onDecide: (action: ManifestAction, source: "suggested" | "override") => void;
  saving: boolean;
  queuePosition: number;
  queueTotal: number;
}) {
  const { manifest, job } = item;
  const changed = new Set(
    job.suggested_action === "Update"
      ? (job.suggested_reason.match(/differs on: (.+)$/)?.[1] ?? "").split(",").map(s => s.trim())
      : []
  );

  return (
    <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
      {/* Booking form preview */}
      <div className="w-[38%] min-w-[280px] shrink-0 flex flex-col min-h-0" style={{ borderRight: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
        <div className="shrink-0 px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--rule)" }}>
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--label)" }}>Booking Form</span>
          {job.pdf_url && (
            <a href={job.pdf_url} target="_blank" rel="noreferrer" className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
              Open ↗
            </a>
          )}
        </div>
        {job.pdf_url ? (
          <iframe
            src={job.pdf_url.replace("/view", "/preview")}
            className="flex-1 w-full border-0"
            title="Booking form PDF"
            allow="autoplay"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center px-6 text-center">
            <span className="text-sm" style={{ color: "var(--label)" }}>No booking form on file for this job</span>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header strip */}
        <div className="shrink-0 px-6 py-4 flex items-center justify-between gap-4" style={{ borderBottom: "1px solid var(--rule)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="tabular text-2xl font-bold" style={{ color: "var(--ink)" }}>{job.job_number}</span>
            {job.client_name && (
              <span className="text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm" style={{ background: "var(--paper-raised)", color: "var(--ink-soft)", border: "1px solid var(--rule)" }}>
                {job.client_name.replace("St Regis ", "")}
              </span>
            )}
            {job.suggested_action && <ActionPill action={job.suggested_action} />}
            <ConfidenceBadge score={job.composite_score} status={job.confidence_status} />
          </div>
          <div className="text-xs tabular shrink-0" style={{ color: "var(--label)" }}>
            {queuePosition} / {queueTotal}
          </div>
        </div>

        {job.suggested_reason && (
          <div className="shrink-0 px-6 pt-3 text-sm" style={{ color: "var(--ink-soft)" }}>
            {job.suggested_reason}
          </div>
        )}

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-6 py-4 grid grid-cols-2 gap-3 content-start">
          <DiffField label="Collection" value={job.collection_point} sub={job.collection_postcode} changed={changed.has("collection_point")} />
          <DiffField label="Delivery" value={job.delivery_point} sub={job.delivery_postcode} changed={changed.has("delivery_point")} />
          <DiffField label="Collection date/time" value={`${job.collection_date} ${job.collection_time}`.trim()} changed={changed.has("collection_date") || changed.has("collection_time")} />
          <DiffField label="Delivery date/time" value={`${job.delivery_date} ${job.delivery_time}`.trim()} changed={changed.has("delivery_date") || changed.has("delivery_time")} />
          <DiffField label="Price" value={job.price} changed={changed.has("price")} />
          <DiffField label="Order number" value={job.order_number} changed={false} />
          <DiffField label="Work type" value={job.work_type} changed={false} />
          <DiffField label="Booking window" value={job.booking_window} changed={false} />

          {job.traffic_note && (
            <div className="col-span-2 rounded-sm px-3 py-2" style={{ background: "var(--accent-tint)", border: "1px solid var(--accent)" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "var(--accent)" }}>Traffic note</div>
              <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{job.traffic_note}</div>
            </div>
          )}

          <div className="col-span-2 mt-2">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--label)" }}>Source manifest</div>
            <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{manifest.subject || "No subject"}</div>
          </div>

          {job.email_body && (
            <div className="col-span-2">
              <EmailBodyPanel body={job.email_body} />
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="shrink-0 px-6 py-4 flex items-center gap-2 flex-wrap" style={{ borderTop: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
          {ACTIONS.map(a => {
            const isSuggested = job.suggested_action === a.key;
            const v = ACTION_VARS[a.key];
            return (
              <button
                key={a.key}
                disabled={saving}
                onClick={() => onDecide(a.key, isSuggested ? "suggested" : "override")}
                className="flex items-center gap-2 px-4 py-2.5 rounded-sm font-bold text-sm transition-colors disabled:opacity-40"
                style={{
                  background: isSuggested ? `var(--${v})` : "var(--paper)",
                  color: isSuggested ? "var(--accent-ink)" : "var(--ink)",
                  border: `1.5px solid var(${isSuggested ? `--${v}` : "--rule"})`,
                }}
              >
                <span className="tabular text-[10px] font-black opacity-70 border px-1 rounded-sm" style={{ borderColor: "currentColor" }}>{a.hotkey}</span>
                {a.verb}
                {isSuggested && <span className="text-[10px] font-normal opacity-80">suggested</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SidebarRow({ item, active, onClick }: { item: QueueItem; active: boolean; onClick: () => void }) {
  const { job } = item;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 transition-colors"
      style={{
        background: active ? "var(--accent-tint)" : "transparent",
        borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
      }}
    >
      <div className="min-w-0">
        <div className="tabular text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{job.job_number}</div>
        <div className="text-[11px] truncate" style={{ color: "var(--label)" }}>
          {job.delivery_point || job.collection_point || "—"}
        </div>
      </div>
      {job.suggested_action && <ActionPill action={job.suggested_action} small />}
    </button>
  );
}

export default function Page() {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [reviewerName, setReviewerName] = useState("");
  const [justDone, setJustDone] = useState<{ job: string; action: ManifestAction } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/manifests")
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        setManifests(d.manifests ?? []);
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const queue = useMemo(
    () => filterByDeliveryDate(buildQueue(manifests), dateFrom, dateTo),
    [manifests, dateFrom, dateTo]
  );
  const current = queue[Math.min(cursor, queue.length - 1)];

  // Filtering can shrink the queue out from under the current cursor position.
  useEffect(() => { setCursor(0); }, [dateFrom, dateTo]);

  const decide = useCallback(async (action: ManifestAction, source: "suggested" | "override") => {
    if (!current) return;
    setSaving(true);
    try {
      const res = await fetch("/api/manifests/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_number: current.job.job_number, action, source, reviewed_by: reviewerName }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to save");

      setJustDone({ job: current.job.job_number, action });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setJustDone(null), 2200);

      setManifests(prev => prev.map(m =>
        m.message_id !== current.manifest.message_id ? m : {
          ...m,
          jobs: m.jobs.map(j => j.job_number === current.job.job_number ? { ...j, review_action: action, review_action_source: source } : j),
        }
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [current, reviewerName]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      const match = ACTIONS.find(a => a.hotkey.toLowerCase() === e.key.toLowerCase());
      if (match && !saving) decide(match.key, current?.job.suggested_action === match.key ? "suggested" : "override");
      if (e.key === "ArrowDown") setCursor(c => Math.min(c + 1, queue.length - 1));
      if (e.key === "ArrowUp") setCursor(c => Math.max(c - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, saving, current, queue.length]);

  const remaining = queue.length;
  const totalJobs = manifests.reduce((n, m) => n + m.jobs.length, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: "var(--paper)" }}>
      {/* Top bar */}
      <header className="shrink-0 px-6 py-3 flex items-center gap-4" style={{ borderBottom: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--accent)" }}>DS Smith</span>
          <span style={{ color: "var(--rule)" }}>/</span>
          <span className="font-bold" style={{ color: "var(--ink)" }}>Manifest Review</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--label)" }}>Delivery</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="tabular text-xs px-2 py-1.5 rounded-sm outline-none"
            style={{ background: "var(--paper)", border: "1px solid var(--rule)", color: "var(--ink)" }}
          />
          <span className="text-xs" style={{ color: "var(--label)" }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="tabular text-xs px-2 py-1.5 rounded-sm outline-none"
            style={{ background: "var(--paper)", border: "1px solid var(--rule)", color: "var(--ink)" }}
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-[11px] font-bold uppercase tracking-wide px-2 py-1.5 rounded-sm"
              style={{ color: "var(--label)" }}
            >
              Clear
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular" style={{ color: "var(--label)" }}>{remaining} of {totalJobs} pending</span>
          <input
            placeholder="Your name"
            value={reviewerName}
            onChange={e => setReviewerName(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-sm outline-none w-32"
            style={{ background: "var(--paper)", border: "1px solid var(--rule)", color: "var(--ink)" }}
          />
          <button onClick={load} className="text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-sm" style={{ border: "1px solid var(--rule)", color: "var(--ink-soft)" }}>
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 px-6 py-2 text-xs" style={{ background: "var(--cancel-tint)", color: "var(--cancel)" }}>{error}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--label)" }}>Loading…</div>
      ) : queue.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <div className="text-lg font-bold" style={{ color: "var(--ink)" }}>Queue clear</div>
          <div className="text-sm" style={{ color: "var(--label)" }}>No jobs waiting for review.</div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Sidebar */}
          <div className="w-72 shrink-0 overflow-y-auto" style={{ borderRight: "1px solid var(--rule)" }}>
            {queue.map((item, i) => (
              <SidebarRow key={item.job.job_number} item={item} active={i === cursor} onClick={() => setCursor(i)} />
            ))}
          </div>

          {/* Focus panel */}
          {current && (
            <JobFocus
              item={current}
              onDecide={decide}
              saving={saving}
              queuePosition={cursor + 1}
              queueTotal={queue.length}
            />
          )}
        </div>
      )}

      {justDone && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-sm text-sm font-bold shadow-lg flex items-center gap-2"
          style={{ background: "var(--ink)", color: "var(--paper)" }}
        >
          <span className="tabular">{justDone.job}</span>
          <span style={{ opacity: 0.6 }}>→</span>
          <span>{justDone.action}</span>
        </div>
      )}
    </div>
  );
}
