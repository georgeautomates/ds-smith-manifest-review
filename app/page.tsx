"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { Manifest, ManifestJob, ManifestAction, Recipient } from "@/lib/db";

type OtherPdfJob = {
  job_number: string;
  message_id: string;
  review_action: ManifestAction | "";
  review_action_by: string;
  review_action_at: string;
  collection_point: string;
  collection_postcode: string;
  delivery_point: string;
  delivery_postcode: string;
  price: string;
  order_number: string;
  collection_date: string;
  collection_time: string;
  delivery_date: string;
  delivery_time: string;
  email_subject: string;
  found: boolean;
};

const DEFAULT_PDF_HEIGHT = 520;
const MIN_PDF_HEIGHT = 240;
const MAX_PDF_HEIGHT = 1000;

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isPending(m: Manifest): boolean {
  return m.jobs.some((j) => !j.review_action);
}

/**
 * The true count of jobs DS Smith put on this booking form, not just the
 * ones that landed on this particular email. pdf_job_numbers is the full
 * list the pipeline saw on the PDF; falls back to the manifest's own job
 * count for older rows ingested before that column existed.
 */
function pdfJobCount(m: Manifest): number {
  const pdfNumbers = m.jobs.find((j) => j.pdf_job_numbers.length > 0)?.pdf_job_numbers;
  if (!pdfNumbers) return m.jobs.length;
  return new Set([...pdfNumbers, ...m.jobs.map((j) => j.job_number)]).size;
}

function ManifestRow({ manifest, active, onClick }: { manifest: Manifest; active: boolean; onClick: () => void }) {
  const jobCount = pdfJobCount(manifest);
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 flex flex-col gap-1 transition-colors"
      style={{
        background: active ? "var(--accent-tint)" : "transparent",
        borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>
          {manifest.subject || "No subject"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] tabular" style={{ color: "var(--label)" }}>{fmtDateTime(manifest.email_received_at)}</span>
        <span className="text-[11px] tabular" style={{ color: "var(--label)" }}>
          {jobCount} order{jobCount === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}

function ExtractionField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "var(--label)" }}>{label}</div>
      <div className="tabular text-xs font-semibold" style={{ color: "var(--ink)" }}>
        {value || <span style={{ color: "var(--label)" }}>—</span>}
      </div>
      {sub && <div className="tabular text-[10px]" style={{ color: "var(--label)" }}>{sub}</div>}
    </div>
  );
}

function OrderCheckRow({
  job,
  checked,
  expanded,
  onToggle,
  onToggleExpand,
}: {
  job: ManifestJob;
  checked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--rule)" }}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 size-4 shrink-0 cursor-pointer" />
        <div className="min-w-0 flex-1">
          <span className="tabular text-sm font-semibold" style={{ color: "var(--ink)" }}>{job.job_number}</span>
          <div className="text-[11px] truncate" style={{ color: "var(--label)" }}>
            {job.delivery_point || job.collection_point || "—"}
          </div>
          {job.suggested_action === "Review" ? (
            <div
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mt-0.5 px-1.5 py-0.5 rounded-sm"
              style={{ background: "var(--cancel-tint)", color: "var(--cancel)" }}
              title="Reply on an existing thread — not a confident new order or amendment, check manually"
            >
              Needs review
            </div>
          ) : job.suggested_action ? (
            <div className="text-[10px] font-bold uppercase tracking-wide mt-0.5" style={{ color: "var(--label)" }}>
              Suggested: {job.suggested_action}
            </div>
          ) : null}
          {job.review_action && (
            <div className="text-[10px] font-bold uppercase tracking-wide mt-0.5" style={{ color: "var(--ignore)" }}>
              Already {job.review_action}
            </div>
          )}
        </div>
        <button
          onClick={onToggleExpand}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors"
          style={{
            background: expanded ? "var(--accent-tint)" : "var(--paper)",
            color: expanded ? "var(--accent)" : "var(--ink-soft)",
            border: `1px solid ${expanded ? "var(--accent)" : "var(--rule)"}`,
          }}
        >
          {expanded ? "Hide" : "Details"}
          <span className="tabular">{expanded ? "▾" : "▸"}</span>
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-2" style={{ background: "var(--paper-raised)" }}>
          <ExtractionField label="Collection" value={job.collection_point} sub={job.collection_postcode} />
          <ExtractionField label="Delivery" value={job.delivery_point} sub={job.delivery_postcode} />
          <ExtractionField label="Collection date/time" value={`${job.collection_date} ${job.collection_time}`.trim()} />
          <ExtractionField label="Delivery date/time" value={`${job.delivery_date} ${job.delivery_time}`.trim()} />
          <ExtractionField label="Price" value={job.price} />
          <ExtractionField label="Order number" value={job.order_number} />
          <ExtractionField label="Work type" value={job.work_type} />
          <ExtractionField label="Booking window" value={job.booking_window} />
          {job.traffic_note && (
            <div className="col-span-2 rounded-sm px-2 py-1.5" style={{ background: "var(--accent-tint)", border: "1px solid var(--accent)" }}>
              <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "var(--accent)" }}>Traffic note</div>
              <div className="text-xs font-semibold" style={{ color: "var(--ink)" }}>{job.traffic_note}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function otherJobStatus(job: OtherPdfJob): string {
  if (!job.found) return "not on file";
  if (job.review_action) return `${job.review_action}, handled on another email`;
  return "awaiting review on another email";
}

/**
 * A job from this PDF that isn't part of this email's own job list — dedup
 * already filed it under an earlier email, so it's read-only here: shown for
 * context (this is why the form's total looks bigger than this list), never
 * checkable, so a reviewer can't re-action something already decided. Still
 * carries the same extracted fields as a normal row so a reviewer can see
 * what that job actually was without leaving this manifest.
 */
function OtherJobRow({ job, expanded, onToggleExpand }: { job: OtherPdfJob; expanded: boolean; onToggleExpand: () => void }) {
  return (
    <div style={{ borderBottom: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
      <div
        className="flex items-start gap-2.5 px-3 py-2.5"
        title="This job was on the same booking form but belongs to a different email — view-only here"
      >
        <div
          className="mt-0.5 size-4 shrink-0 rounded-sm flex items-center justify-center"
          style={{ border: "1px solid var(--rule)", color: "var(--label)", fontSize: 10 }}
        >
          ○
        </div>
        <div className="min-w-0 flex-1">
          <span className="tabular text-sm font-semibold" style={{ color: "var(--label)" }}>{job.job_number}</span>
          <div className="text-[11px] truncate" style={{ color: "var(--label)" }}>
            {job.delivery_point || job.collection_point || "—"}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wide mt-0.5" style={{ color: "var(--label)" }}>
            {otherJobStatus(job)}
            {job.review_action_at ? ` · ${fmtDateTime(job.review_action_at)}` : ""}
            {job.review_action_by ? ` · ${job.review_action_by}` : ""}
          </div>
        </div>
        {job.found && (
          <button
            onClick={onToggleExpand}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors"
            style={{
              background: expanded ? "var(--accent-tint)" : "var(--paper)",
              color: expanded ? "var(--accent)" : "var(--ink-soft)",
              border: `1px solid ${expanded ? "var(--accent)" : "var(--rule)"}`,
            }}
          >
            {expanded ? "Hide" : "Details"}
            <span className="tabular">{expanded ? "▾" : "▸"}</span>
          </button>
        )}
      </div>
      {expanded && job.found && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-2">
          <ExtractionField label="Collection" value={job.collection_point} sub={job.collection_postcode} />
          <ExtractionField label="Delivery" value={job.delivery_point} sub={job.delivery_postcode} />
          <ExtractionField label="Collection date/time" value={`${job.collection_date} ${job.collection_time}`.trim()} />
          <ExtractionField label="Delivery date/time" value={`${job.delivery_date} ${job.delivery_time}`.trim()} />
          <ExtractionField label="Price" value={job.price} />
          <ExtractionField label="Order number" value={job.order_number} />
          <div className="col-span-2">
            <ExtractionField label="From email" value={job.email_subject} />
          </div>
        </div>
      )}
    </div>
  );
}

function ManifestDetail({
  manifest,
  onProcessed,
}: {
  manifest: Manifest;
  onProcessed: (messageId: string, jobNumbers: string[]) => void;
}) {
  const pendingJobs = useMemo(() => manifest.jobs.filter((j) => !j.review_action), [manifest]);
  // "Review" jobs (chain-reply emails, no confident suggestion) never
  // default-checked — there's no safe action to auto-accept, so they start
  // as Ignore (unchecked) until a reviewer looks closer and decides.
  const [checkedJobs, setCheckedJobs] = useState<Set<string>>(
    () => new Set(pendingJobs.filter((j) => j.suggested_action && j.suggested_action !== "Review").map((j) => j.job_number))
  );
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  // null = fill available height (the default — no fixed height means no dead
  // space below the PDF on a tall window). Only becomes a concrete pixel value
  // once the reviewer actually drags the resize handle.
  const [pdfHeight, setPdfHeight] = useState<number | null>(null);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const [otherJobs, setOtherJobs] = useState<OtherPdfJob[]>([]);

  // Full booking-form job list, own (checkable) jobs and other-email (read-only)
  // jobs interleaved by job number, so the panel always matches what's actually
  // printed on the PDF instead of silently showing a subset.
  type Row = { job_number: string } & ({ kind: "own"; job: ManifestJob } | { kind: "other"; job: OtherPdfJob });
  const rows: Row[] = useMemo(() => {
    const own: Row[] = manifest.jobs.map((job) => ({ kind: "own" as const, job, job_number: job.job_number }));
    const other: Row[] = otherJobs.map((job) => ({ kind: "other" as const, job, job_number: job.job_number }));
    return [...own, ...other].sort((a, b) => a.job_number.localeCompare(b.job_number));
  }, [manifest.jobs, otherJobs]);

  useEffect(() => {
    setCheckedJobs(new Set(pendingJobs.map((j) => j.job_number)));
  }, [manifest.message_id, pendingJobs]);

  useEffect(() => {
    let cancelled = false;
    setOtherJobs([]);
    fetch(`/api/manifests/${encodeURIComponent(manifest.message_id)}/pdf-jobs`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setOtherJobs(d.otherJobs ?? []); })
      .catch(() => { if (!cancelled) setOtherJobs([]); });
    return () => { cancelled = true; };
  }, [manifest.message_id]);

  const pdfUrl = manifest.jobs.find((j) => j.pdf_url)?.pdf_url ?? "";

  function toggle(jobNumber: string) {
    setCheckedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobNumber)) next.delete(jobNumber);
      else next.add(jobNumber);
      return next;
    });
  }

  function onDragStart(e: React.PointerEvent) {
    // pdfHeight is null until the reviewer's first drag — seed the drag from
    // the panel's actual current (auto-filled) height so the PDF doesn't jump.
    const currentHeight = pdfHeight ?? e.currentTarget.previousElementSibling?.getBoundingClientRect().height ?? DEFAULT_PDF_HEIGHT;
    dragState.current = { startY: e.clientY, startHeight: currentHeight };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragMove(e: React.PointerEvent) {
    if (!dragState.current) return;
    const delta = e.clientY - dragState.current.startY;
    setPdfHeight(Math.min(MAX_PDF_HEIGHT, Math.max(MIN_PDF_HEIGHT, dragState.current.startHeight + delta)));
  }
  function onDragEnd() {
    dragState.current = null;
  }

  async function handleProcess() {
    if (pendingJobs.length === 0) return;
    setProcessing(true);
    setError("");
    try {
      for (const job of pendingJobs) {
        const isChecked = checkedJobs.has(job.job_number);
        // "Review" is never a valid action to save — if a Review job somehow
        // ends up checked, still fall back to Add rather than send an invalid
        // action to the API.
        const suggestion: ManifestAction = job.suggested_action && job.suggested_action !== "Review" ? job.suggested_action : "Add";
        const action: ManifestAction = isChecked ? suggestion : "Ignore";
        const source: "suggested" | "override" = isChecked && job.suggested_action === action ? "suggested" : "override";
        const res = await fetch("/api/manifests/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_number: job.job_number, action, source, reviewed_by: "" }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? `Failed to save ${job.job_number}`);
      }
      onProcessed(manifest.message_id, pendingJobs.map((j) => j.job_number));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Subject line */}
      <div className="shrink-0 px-6 py-3" style={{ borderBottom: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
        <div className="text-[11px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "var(--label)" }}>Subject</div>
        <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{manifest.subject || "No subject"}</div>
      </div>

      <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
        {/* Booking form, resizable */}
        <div className="flex-1 flex flex-col min-w-0" style={{ borderRight: "1px solid var(--rule)" }}>
          <div
            style={pdfHeight != null ? { height: pdfHeight } : undefined}
            className={pdfHeight != null ? "shrink-0 flex flex-col min-h-0" : "flex-1 flex flex-col min-h-0"}
          >
            {pdfUrl ? (
              <iframe
                src={pdfUrl.replace("/view", "/preview")}
                className="flex-1 w-full border-0"
                title="Booking form PDF"
                allow="autoplay"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center px-6 text-center" style={{ background: "var(--paper-raised)" }}>
                <span className="text-sm" style={{ color: "var(--label)" }}>No booking form on file for this manifest</span>
              </div>
            )}
          </div>
          <div
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            className="shrink-0 h-2 cursor-row-resize flex items-center justify-center"
            style={{ background: "var(--paper-raised)", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)" }}
            title="Drag to resize"
          >
            <span className="w-8 h-0.5 rounded-full" style={{ background: "var(--rule)" }} />
          </div>
          {pdfUrl && (
            <div className="shrink-0 max-h-32 overflow-y-auto px-6 py-3">
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                Open booking form in new tab ↗
              </a>
            </div>
          )}
        </div>

        {/* Order checklist */}
        <div className="w-80 shrink-0 flex flex-col min-h-0">
          <div className="shrink-0 px-3 py-2.5" style={{ borderBottom: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--label)" }}>
              Order numbers
            </span>
            <span className="text-[11px] tabular ml-1.5" style={{ color: "var(--label)" }}>
              ({rows.length} on this form{otherJobs.length > 0 ? `, ${otherJobs.length} handled elsewhere` : ""})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {rows.map((row) =>
              row.kind === "own" ? (
                <OrderCheckRow
                  key={row.job_number}
                  job={row.job}
                  checked={checkedJobs.has(row.job_number)}
                  expanded={expandedJob === row.job_number}
                  onToggle={() => toggle(row.job_number)}
                  onToggleExpand={() => setExpandedJob((prev) => (prev === row.job_number ? null : row.job_number))}
                />
              ) : (
                <OtherJobRow
                  key={row.job_number}
                  job={row.job}
                  expanded={expandedJob === row.job_number}
                  onToggleExpand={() => setExpandedJob((prev) => (prev === row.job_number ? null : row.job_number))}
                />
              )
            )}
          </div>
          <div className="shrink-0 px-3 py-3" style={{ borderTop: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
            {error && <div className="text-xs mb-2" style={{ color: "var(--cancel)" }}>{error}</div>}
            <button
              onClick={handleProcess}
              disabled={processing || pendingJobs.length === 0}
              className="w-full py-2.5 rounded-sm font-bold text-sm transition-colors disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              {processing ? "Processing…" : pendingJobs.length === 0 ? "Already processed" : "Process"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Who gets notified when a manifest is waiting for review. The Firmin team
 * maintain this themselves — the sending agent reads the same table at send
 * time, so changes take effect on the next email with no redeploy.
 */
function RecipientsPanel() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const d = await (await fetch("/api/recipients")).json();
      if (!d.ok) { setError(d.error ?? "Could not load recipients"); return; }
      setRecipients(d.recipients ?? []);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Both add and remove return the refreshed list, so the panel never has to
  // guess at the new state or fire a second round-trip to find out.
  async function send(method: "POST" | "DELETE", body: object, failMsg: string) {
    if (busy) return;
    setBusy(true);
    try {
      const d = await (await fetch("/api/recipients", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })).json();
      if (!d.ok) { setError(d.error ?? failMsg); return; }
      setRecipients(d.recipients ?? []);
      setError("");
      return true;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    if (await send("POST", { email: value }, "Could not add that address")) setEmail("");
  }

  return (
    <div
      className="absolute right-0 top-full mt-1 w-80 z-20 rounded-sm shadow-lg"
      style={{ background: "var(--paper-raised)", border: "1px solid var(--rule)" }}
    >
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--rule)" }}>
        <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--label)" }}>
          Review notifications
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-soft)" }}>
          Everyone here is emailed when a manifest needs review.
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-[11px]" style={{ background: "var(--cancel-tint)", color: "var(--cancel)" }}>
          {error}
        </div>
      )}

      <div className="max-h-56 overflow-y-auto">
        {!loaded ? (
          <div className="px-3 py-3 text-[11px]" style={{ color: "var(--label)" }}>Loading…</div>
        ) : recipients.length === 0 ? (
          <div className="px-3 py-3 text-[11px]" style={{ color: "var(--label)" }}>
            Nobody is being notified yet. Add an address below.
          </div>
        ) : (
          recipients.map((r) => (
            <div
              key={r.id}
              className="px-3 py-2 flex items-center gap-2"
              style={{ borderBottom: "1px solid var(--rule)" }}
            >
              <span className="text-[12px] truncate flex-1" style={{ color: "var(--ink)" }}>{r.email}</span>
              <button
                onClick={() => send("DELETE", { id: r.id }, "Could not remove that address")}
                disabled={busy}
                title={`Stop notifying ${r.email}`}
                className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm shrink-0"
                style={{ color: "var(--cancel)", border: "1px solid var(--rule)" }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <form onSubmit={add} className="p-2 flex gap-1.5" style={{ borderTop: "1px solid var(--rule)" }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          className="flex-1 min-w-0 px-2 py-1 text-[12px] rounded-sm"
          style={{ border: "1px solid var(--rule)", background: "var(--paper)", color: "var(--ink)" }}
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="text-[10px] font-bold uppercase tracking-wide px-2.5 rounded-sm shrink-0"
          style={{ background: "var(--accent)", color: "var(--paper-raised)", opacity: busy || !email.trim() ? 0.5 : 1 }}
        >
          Add
        </button>
      </form>
    </div>
  );
}

export default function Page() {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"new" | "processed">("new");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRecipients, setShowRecipients] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/manifests/all")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setManifests(d.manifests ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const newManifests = useMemo(() => manifests.filter(isPending), [manifests]);
  const processedManifests = useMemo(() => manifests.filter((m) => !isPending(m)), [manifests]);
  const visible = filter === "new" ? newManifests : processedManifests;

  useEffect(() => {
    if (visible.length === 0) { setSelectedId(null); return; }
    if (!visible.some((m) => m.message_id === selectedId)) setSelectedId(visible[0].message_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Open straight onto one manifest from ?m=<message_id> — the link the
  // notification email sends the Firmin team. Declared AFTER the auto-select
  // effect above on purpose: both run in the same flush once manifests land,
  // and the later setSelectedId wins, otherwise auto-select would immediately
  // bounce us to visible[0].
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || manifests.length === 0) return;
    deepLinkApplied.current = true;
    const wanted = new URLSearchParams(window.location.search).get("m");
    if (!wanted) return;
    const target = manifests.find((m) => m.message_id === wanted);
    if (!target) return;  // stale or wrong-client link — leave the default view alone
    // A linked manifest is often already processed by the time someone clicks
    // through from their inbox, so land on whichever tab actually holds it.
    setFilter(isPending(target) ? "new" : "processed");
    setSelectedId(wanted);
  }, [manifests]);

  // Keep the address bar in step with the selection so the URL is always
  // shareable/copyable. replaceState, not pushState — clicking through a list
  // shouldn't stack up dozens of back-button entries.
  useEffect(() => {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("m") === selectedId) return;
    url.searchParams.set("m", selectedId);
    window.history.replaceState(null, "", url);
  }, [selectedId]);

  const selected = visible.find((m) => m.message_id === selectedId) ?? null;

  function handleProcessed(messageId: string, jobNumbers: string[]) {
    setManifests((prev) => prev.map((m) => {
      if (m.message_id !== messageId) return m;
      return {
        ...m,
        jobs: m.jobs.map((j) => (j.review_action ? j : { ...j, review_action: "Ignore" as ManifestAction })),
      };
    }));
    // Re-fetch to pick up the real actions/timestamps written server-side.
    load();
    setFilter("new");
    showToast(`${jobNumbers.length} order${jobNumbers.length === 1 ? "" : "s"} processed`);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: "var(--paper)" }}>
      <header className="shrink-0 px-6 py-3 flex items-center gap-4" style={{ borderBottom: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
        <div className="shrink-0 rounded-sm px-2 py-1" style={{ background: "#FFFFFF" }}>
          <img src="/firmin-logo.png" alt="Alan Firmin" className="h-5 w-auto block" />
        </div>
        <span style={{ color: "var(--rule)" }}>|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--accent)" }}>DS Smith</span>
          <span style={{ color: "var(--rule)" }}>/</span>
          <span className="font-bold" style={{ color: "var(--ink)" }}>Manifest Review</span>
        </div>
        <div className="ml-auto flex items-center gap-3 relative">
          <button
            onClick={() => setShowRecipients((v) => !v)}
            className="text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-sm"
            style={{ border: "1px solid var(--rule)", color: showRecipients ? "var(--accent)" : "var(--ink-soft)" }}
          >
            Recipients
          </button>
          <button onClick={load} className="text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-sm" style={{ border: "1px solid var(--rule)", color: "var(--ink-soft)" }}>
            Refresh
          </button>
          {showRecipients && <RecipientsPanel />}
        </div>
      </header>

      {error && (
        <div className="shrink-0 px-6 py-2 text-xs" style={{ background: "var(--cancel-tint)", color: "var(--cancel)" }}>{error}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--label)" }}>Loading…</div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left column: New / Processed filter + list */}
          <div className="w-80 shrink-0 flex flex-col min-h-0" style={{ borderRight: "1px solid var(--rule)" }}>
            <div className="shrink-0 flex" style={{ borderBottom: "1px solid var(--rule)" }}>
              {(["new", "processed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wide transition-colors"
                  style={{
                    color: filter === f ? "var(--accent)" : "var(--label)",
                    borderBottom: `2px solid ${filter === f ? "var(--accent)" : "transparent"}`,
                  }}
                >
                  {f === "new" ? `New Orders (${newManifests.length})` : `Processed (${processedManifests.length})`}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--label)" }}>
                  {filter === "new" ? "No orders need to process." : "Nothing processed yet."}
                </div>
              ) : (
                visible.map((m) => (
                  <ManifestRow
                    key={m.message_id}
                    manifest={m}
                    active={m.message_id === selectedId}
                    onClick={() => setSelectedId(m.message_id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Detail panel */}
          {selected ? (
            <ManifestDetail manifest={selected} onProcessed={handleProcessed} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--label)" }}>
              {filter === "new" ? "No orders need to process." : "Select a manifest to view it."}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-sm px-4 py-3 text-sm font-semibold shadow-lg"
          style={{
            background: "var(--add-tint)",
            color: "var(--add)",
            border: "1px solid var(--add)",
            animation: "toast-in 0.2s ease-out",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}
