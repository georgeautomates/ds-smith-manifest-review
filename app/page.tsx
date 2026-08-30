"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { Manifest, ManifestJob, ManifestAction, Recipient, CorrectableField, PendingChange, JobOccurrence } from "@/lib/db";
import { PdfViewer } from "@/components/pdf-viewer";

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
  // Job numbers weren't shown anywhere in the list — the only way to find a
  // specific job was already knowing which email it arrived on. Truncated
  // rather than every job on a large manifest, since this is a scan aid,
  // not the full detail (that's in the panel once a row is selected).
  const jobNumbers = manifest.jobs.map((j) => j.job_number);
  const shown = jobNumbers.slice(0, 4).join(", ");
  const extra = jobNumbers.length > 4 ? ` +${jobNumbers.length - 4} more` : "";
  // "N orders" told a reviewer how big the manifest was, but not how much of
  // it they'd actually gotten through — a manifest with 9 of 10 decided
  // looked identical in the list to one nobody had opened yet. Reuses the
  // manifest's own job rows (already fetched, no new query) to count how
  // many already have a review_action set.
  const decidedCount = manifest.jobs.filter((j) => j.review_action).length;
  const allDecided = jobCount > 0 && decidedCount >= jobCount;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 flex flex-col gap-1 transition-colors"
      style={{
        background: active ? "var(--accent-tint)" : "transparent",
        borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
      }}
    >
      {/* Job numbers are the bold/primary line, subject the smaller one below it -
          the reverse of how this used to read. Many DS Smith subjects repeat
          identically across several genuinely distinct emails (confirmed live
          2026-08-30: one 8-manifest run all titled "FW: firmins bristol by 2pm
          fibre for tuesday", same received timestamp, same thread - a real mail-
          transport quirk on DS Smith's side, not a dedup bug here), so leading
          with the subject made a whole run of rows look like duplicates. Job
          numbers are what's actually unique per row; scan by those instead. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular truncate" style={{ color: "var(--ink)" }}>
          {shown}{extra}
        </span>
      </div>
      <div className="text-[10px] truncate" style={{ color: "var(--label)" }}>
        {manifest.subject || "No subject"}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] tabular" style={{ color: "var(--label)" }}>{fmtDateTime(manifest.email_received_at)}</span>
        <span
          className="text-[11px] tabular font-semibold"
          style={{ color: allDecided ? "var(--accent)" : "var(--label)" }}
        >
          {decidedCount}/{jobCount} reviewed
        </span>
      </div>
    </button>
  );
}

// Read-only display for a field with no correction affordance. Used by the
// "other jobs on this PDF" panel, whose rows come from a different query
// (OtherPdfJob) that carries no pending_changes — so no diff can be shown
// there. The manifest's own jobs use CorrectableExtractionField instead,
// which does surface both system diffs and reviewer corrections.
function ExtractionField({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
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

/**
 * Same as ExtractionField, but for a field a reviewer can propose a
 * correction on. Deliberately friction-y: correcting requires opening a
 * small form and typing a reason, rather than editing the value inline —
 * see lib/db.ts's proposeCorrection docstring for why a silent overwrite
 * is exactly the failure mode this avoids.
 */
function CorrectableExtractionField({
  label,
  fieldKey,
  value,
  sub,
  jobNumber,
  messageId,
  pendingChanges,
  onProposed,
}: {
  label: string;
  fieldKey: CorrectableField;
  value: string;
  sub?: string;
  jobNumber: string;
  messageId: string;
  pendingChanges: PendingChange[];
  onProposed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newValue, setNewValue] = useState(value);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fieldChanges = pendingChanges.filter((c) => c.field === fieldKey && c.source === "human_correction");
  // A system-detected diff means the STORED value is stale: the pipeline skips
  // re-writing a job it's already seen, so a re-sent manifest's new value only
  // exists here, never in the row itself. Lead with that, not the stale `value`.
  //
  // Matched by "not a human correction" rather than "source is unset". The
  // classifier now tags its own entries source:"system_resend" (matching what
  // document_pending_changes_human_correction_shape.sql describes), so an
  // unset-source test silently stops matching every new entry and quietly
  // reverts this field to showing the superseded value. Older rows written
  // before that tag exists have no source at all and still need to match.
  const systemChange = pendingChanges.find(
    (c) => c.field === fieldKey && c.source !== "human_correction",
  );
  const displayValue = systemChange ? systemChange.current : value;

  async function handlePropose() {
    if (!reason.trim() || !newValue.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/manifests/correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_number: jobNumber,
          message_id: messageId,
          field: fieldKey,
          current_value: value,
          new_value: newValue.trim(),
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to save correction");
      setOpen(false);
      setReason("");
      onProposed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save correction");
    } finally {
      setSaving(false);
    }
  }

  async function handleApply(change: PendingChange) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/manifests/correction/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_number: jobNumber,
          message_id: messageId,
          field: fieldKey,
          proposed_at: change.proposed_at,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to apply correction");
      onProposed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply correction");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-1">
        <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "var(--label)" }}>{label}</div>
        <button
          onClick={() => { setNewValue(value); setOpen((o) => !o); }}
          className="text-[10px] font-bold uppercase tracking-wide cursor-pointer px-1.5 py-0.5 rounded-sm"
          style={
            open
              ? { color: "var(--ink-soft)", background: "var(--paper)", border: "1px solid var(--rule)" }
              : { color: "var(--accent)", background: "var(--accent-tint)", border: "1px solid var(--accent)" }
          }
          title="Propose a correction to this field"
        >
          {open ? "cancel" : "edit"}
        </button>
      </div>
      <div className="tabular text-xs font-semibold" style={{ color: systemChange ? "var(--accent)" : "var(--ink)" }}>
        {displayValue || <span style={{ color: "var(--label)" }}>—</span>}
      </div>
      {systemChange && (
        <div className="tabular text-[10px] line-through" style={{ color: "var(--label)" }}>
          {systemChange.previous || "(blank)"}
        </div>
      )}
      {sub && <div className="tabular text-[10px]" style={{ color: "var(--label)" }}>{sub}</div>}

      {fieldChanges.length > 0 && (
        <div className="mt-1 space-y-1">
          {fieldChanges.map((c, i) => (
            <div key={i} className="rounded-sm px-1.5 py-1 text-[10px]" style={{ background: "var(--accent-tint)", border: "1px solid var(--accent)" }}>
              <div className="tabular font-semibold" style={{ color: "var(--ink)" }}>
                {c.previous || "—"} → {c.current}
              </div>
              <div style={{ color: "var(--label)" }}>{c.reason}</div>
              <div style={{ color: "var(--label)" }}>
                {c.applied_at
                  ? `Applied by ${c.applied_by}`
                  : (
                    <>
                      Proposed by {c.proposed_by}{" "}
                      <button
                        onClick={() => handleApply(c)}
                        disabled={saving}
                        className="font-bold uppercase cursor-pointer disabled:opacity-40"
                        style={{ color: "var(--accent)" }}
                      >
                        apply
                      </button>
                    </>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-1.5 space-y-1.5">
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Corrected value"
            className="w-full text-xs px-1.5 py-1 rounded-sm"
            style={{ border: "1px solid var(--rule)", background: "var(--paper)", color: "var(--ink)" }}
          />
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? (required — e.g. checked source PDF, extraction is correct)"
            rows={2}
            className="w-full text-xs px-1.5 py-1 rounded-sm resize-none"
            style={{ border: "1px solid var(--rule)", background: "var(--paper)", color: "var(--ink)" }}
          />
          {error && <div className="text-[10px]" style={{ color: "var(--cancel)" }}>{error}</div>}
          <button
            onClick={handlePropose}
            disabled={saving || !reason.trim() || !newValue.trim()}
            className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-sm cursor-pointer disabled:opacity-40"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {saving ? "Saving…" : "Propose correction"}
          </button>
        </div>
      )}
    </div>
  );
}

const MANIFEST_ACTIONS: ManifestAction[] = ["Add", "Cancel"];

// Per-action colour, keyed to this file's existing --add/--cancel CSS
// variables (already used elsewhere for suggestion badges) so the picker
// matches whichever theme (light/dark) the page is rendering in. White text
// on both — each is a mid-to-dark colour in both themes (see
// app/globals.css), so a single fixed ink colour is simpler than inventing
// new per-action -ink tokens for one component.
const ACTION_STYLE: Record<ManifestAction, { bg: string; tint: string; border: string }> = {
  Add:    { bg: "var(--add)",    tint: "var(--add-tint)",    border: "var(--add)" },
  Cancel: { bg: "var(--cancel)", tint: "var(--cancel-tint)", border: "var(--cancel)" },
};

// What each action actually means, in the reviewer's own terms, not the
// system's. Shown as each button's tooltip so the meaning is one hover away
// without permanently costing row height. Update and Ignore were removed —
// there's no order-amendment path into Proteo from here, and a repeat order
// is now shown directly via the "seen before" badge rather than a separate
// action a reviewer has to choose.
const ACTION_HINT: Record<ManifestAction, string> = {
  Add: "This order needs entering in the Client Portal — fills it automatically, you still confirm it there. Covers a genuine new order and a repeat that hasn't actually been processed yet.",
  Cancel: "DS Smith cancelled this order — you cancel it in Proteo by hand, nothing automatic happens here",
};

/**
 * Lets a reviewer force either action, not just accept the suggestion. The
 * backend API (app/api/manifests/action/route.ts) accepts both with a
 * suggested/override source.
 */
function ActionPicker({
  job,
  selected,
  onSelect,
}: {
  job: ManifestJob;
  selected: ManifestAction;
  onSelect: (action: ManifestAction) => void;
}) {
  return (
    <div className="mt-1">
      <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--label)" }}>
        What is this order?
      </div>
      <div className="flex gap-1 flex-wrap">
        {MANIFEST_ACTIONS.map((action) => {
          const isSelected = selected === action;
          const isSuggested = job.suggested_action === action;
          const style = ACTION_STYLE[action];
          const hint = ACTION_HINT[action] + (isSuggested ? " (system-suggested)" : "");
          return (
            <button
              key={action}
              type="button"
              onClick={() => onSelect(action)}
              title={hint}
              className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-sm border-2 transition-colors"
              style={
                // Tinted + bold border for "your current pick," not the solid fill —
                // solid fill is reserved for a job whose decision is actually saved
                // (see the "✓ {action}" badge above, once review_action is set), so
                // the two states can never look the same. Was identical to the saved
                // badge before this change — confirmed real 2026-08-26, caused a
                // genuine mistake mid-session.
                isSelected
                  ? { background: style.tint, color: style.bg, borderColor: style.border }
                  : { background: "var(--paper)", color: "var(--label)", borderColor: "var(--rule)" }
              }
            >
              {action}
              {isSuggested && !isSelected && <span className="ml-1 opacity-70">•</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function occurrenceStatus(o: JobOccurrence): string {
  if (o.rpa_processed) return "processed via RPA";
  if (o.review_action === "Cancel") return "cancelled";
  return "not yet processed";
}

/**
 * "Seen before" indicator — a small pill next to the job number, only
 * rendered when this job_number has more than one row in st_regis_orders
 * (st_regis_orders' primary key is now (job_number, message_id), so a real
 * repeat is a genuinely separate row, not a merged/overwritten one — see
 * the multi-occurrence migration). Stays a link/expand, not a separate
 * read-only list item like OtherJobRow, because every occurrence — this
 * one included — must stay independently actionable: this badge is
 * informational only, it never blocks or pre-fills the ActionPicker above it.
 *
 * Fetches lazily on first expand, not prefetched for every row — avoids an
 * N+1 burst of requests across a 40-job manifest when most jobs have never
 * repeated at all.
 */
function PriorOccurrenceBadge({ jobNumber, currentMessageId }: { jobNumber: string; currentMessageId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [occurrences, setOccurrences] = useState<JobOccurrence[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && occurrences === null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/manifests/job-occurrences/${encodeURIComponent(jobNumber)}`);
        const data = await res.json();
        setOccurrences((data.occurrences ?? []) as JobOccurrence[]);
      } catch {
        setOccurrences([]);
      } finally {
        setLoading(false);
      }
    }
  }

  // Prior occurrences only — the current row's own sighting doesn't count
  // as "seen before" from its own perspective.
  const others = (occurrences ?? []).filter((o) => o.message_id !== currentMessageId);
  if (occurrences !== null && others.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border"
        style={{ background: "var(--paper-raised)", color: "var(--ink-soft)", borderColor: "var(--rule)" }}
      >
        {occurrences === null ? "Seen before?" : `Seen ${others.length + 1}× before`}
        <span className="tabular">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-1 rounded-sm border" style={{ borderColor: "var(--rule)", background: "var(--paper-raised)" }}>
          {loading ? (
            <div className="px-2 py-1.5 text-[10px]" style={{ color: "var(--label)" }}>Loading…</div>
          ) : others.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px]" style={{ color: "var(--label)" }}>No other occurrences</div>
          ) : (
            others.map((o) => (
              <div key={o.message_id} className="px-2 py-1.5 text-[10px] leading-snug" style={{ borderTop: "1px solid var(--rule)" }}>
                <div className="font-semibold truncate" style={{ color: "var(--ink)" }}>{o.email_subject || "(no subject)"}</div>
                <div style={{ color: "var(--label)" }}>
                  {o.review_action || "unreviewed"} · {occurrenceStatus(o)}
                  {o.review_action_at ? ` · ${fmtDateTime(o.review_action_at)}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function OrderCheckRow({
  job,
  selectedAction,
  expanded,
  onSelectAction,
  onToggleExpand,
  pendingChanges,
  onCorrectionChanged,
}: {
  job: ManifestJob;
  selectedAction: ManifestAction;
  expanded: boolean;
  onSelectAction: (action: ManifestAction) => void;
  onToggleExpand: () => void;
  pendingChanges: PendingChange[];
  onCorrectionChanged: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--rule)" }}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="tabular text-sm font-semibold" style={{ color: "var(--ink)" }}>{job.job_number}</span>
          <div className="text-[11px] truncate" style={{ color: "var(--label)" }}>
            {job.delivery_point || job.collection_point || "—"}
          </div>
          <PriorOccurrenceBadge jobNumber={job.job_number} currentMessageId={job.message_id} />
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
          {/* A decided job showed the SAME interactive 4-button picker as a still-pending
              one, with its already-saved action rendered solid-filled — visually identical
              to a fresh, unsaved selection. Confirmed real 2026-08-26: caused a genuine
              mistake mid-session (a click on the picker was mistaken for a completed save).
              Now: decided jobs get a plain, non-interactive status badge instead of the
              picker at all — re-picking a saved decision does nothing anyway (the picker
              only ever submits via pendingJobs), so showing it implied an action that
              wasn't really available. */}
          {job.review_action ? (
            <div
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mt-1 px-1.5 py-0.5 rounded-sm"
              style={{ background: ACTION_STYLE[job.review_action].bg, color: "#FFFFFF" }}
            >
              ✓ {job.review_action}
            </div>
          ) : (
            <ActionPicker job={job} selected={selectedAction} onSelect={onSelectAction} />
          )}
          {/* The reason, not just the verdict. When the extracted data differs from
              what's on file, this carries the actual field-level diff
              ("delivery_date: 17/08/2026 -> 18/08/2026"), which is the only place
              the OLD value exists — the row itself already shows the new one. The
              Client Portal RPA has no update-in-place path, so applying a change
              from a resend is still a human job at Add time. */}
          {job.suggested_reason && (
            <div className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--ink-soft)" }}>
              {job.suggested_reason}
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
          <CorrectableExtractionField label="Collection" fieldKey="collection_point" value={job.collection_point} sub={job.collection_postcode}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Delivery" fieldKey="delivery_point" value={job.delivery_point} sub={job.delivery_postcode}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Collection date" fieldKey="collection_date" value={job.collection_date}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Collection time" fieldKey="collection_time" value={job.collection_time}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Delivery date" fieldKey="delivery_date" value={job.delivery_date}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Delivery time" fieldKey="delivery_time" value={job.delivery_time}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Price" fieldKey="price" value={job.price}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Order number" fieldKey="order_number" value={job.order_number}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Work type" fieldKey="work_type" value={job.work_type}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
          <CorrectableExtractionField label="Booking window" fieldKey="booking_window" value={job.booking_window}
            jobNumber={job.job_number} messageId={job.message_id} pendingChanges={pendingChanges} onProposed={onCorrectionChanged} />
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
  // Per-job selected action, defaulting to the system's own suggestion.
  // "Review" jobs (chain-reply emails, no confident suggestion) default to
  // Add instead — there's no safe "do nothing" action anymore (Ignore was
  // removed, see lib/db.ts's ManifestAction docstring), and defaulting to
  // "skip this silently" is exactly the class of bug this whole session has
  // been fixing elsewhere (a real order getting missed). Worst case with an
  // Add default is one extra reviewer click to Cancel instead. A reviewer
  // can override any job to either action via ActionPicker regardless of
  // what was suggested.
  function defaultAction(job: ManifestJob): ManifestAction {
    return job.suggested_action && job.suggested_action !== "Review" ? job.suggested_action : "Add";
  }
  const [selectedActions, setSelectedActions] = useState<Record<string, ManifestAction>>(
    () => Object.fromEntries(pendingJobs.map((j) => [j.job_number, defaultAction(j)]))
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
  // pending_changes as returned by the server can go stale the moment a
  // correction is proposed or applied — manifest is a prop, this component
  // has no way to refetch it. Keyed by job_number, only ever set by
  // handleCorrectionChanged below; falls back to the prop's own value.
  const [pendingChangesOverride, setPendingChangesOverride] = useState<Record<string, PendingChange[]>>({});

  function jobPendingChanges(job: ManifestJob): PendingChange[] {
    return pendingChangesOverride[job.job_number] ?? job.pending_changes;
  }

  async function refetchPendingChanges(jobNumber: string) {
    try {
      const res = await fetch(`/api/manifests/${encodeURIComponent(manifest.message_id)}`);
      const data = await res.json();
      const fresh = (data?.manifest?.jobs as ManifestJob[] | undefined)?.find((j) => j.job_number === jobNumber);
      if (fresh) {
        setPendingChangesOverride((prev) => ({ ...prev, [jobNumber]: fresh.pending_changes }));
      }
    } catch {
      // Best-effort — the correction itself already succeeded (that's what
      // triggered this refetch); a stale display here isn't worth surfacing
      // as an error to the reviewer.
    }
  }

  // Full booking-form job list. This email's own jobs always come first (sorted
  // among themselves), since those are what the reviewer is actually here to
  // action — other-PDF jobs (read-only, already handled or pending elsewhere)
  // follow after, sorted among themselves too.
  type Row = { job_number: string } & ({ kind: "own"; job: ManifestJob } | { kind: "other"; job: OtherPdfJob });
  const rows: Row[] = useMemo(() => {
    const own: Row[] = manifest.jobs
      .map((job) => ({ kind: "own" as const, job, job_number: job.job_number }))
      .sort((a, b) => a.job_number.localeCompare(b.job_number));
    const other: Row[] = otherJobs
      .map((job) => ({ kind: "other" as const, job, job_number: job.job_number }))
      .sort((a, b) => a.job_number.localeCompare(b.job_number));
    return [...own, ...other];
  }, [manifest.jobs, otherJobs]);

  useEffect(() => {
    setSelectedActions(Object.fromEntries(pendingJobs.map((j) => [j.job_number, defaultAction(j)])));
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

  function selectAction(jobNumber: string, action: ManifestAction) {
    setSelectedActions((prev) => ({ ...prev, [jobNumber]: action }));
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

  // A job with an unapplied human_correction is about to be Added/Updated
  // with stale data - the RPA fills from the stored row, not from an open
  // proposal. Previously this shipped anyway and relied on a later
  // correction-triggered re-run to fix it after the fact, which only
  // actually happens once the poll loop gets back around to it (it can
  // trail a busy RPA backlog by 20+ minutes - confirmed live 2026-08-24).
  // Blocking here means the RPA only ever runs once, with the right data
  // from the start, instead of once wrong then once corrected.
  function unresolvedCorrections(job: ManifestJob): PendingChange[] {
    return jobPendingChanges(job).filter((c) => c.source === "human_correction" && !c.applied_at);
  }

  async function handleProcess() {
    if (pendingJobs.length === 0) return;
    const blocked = pendingJobs.filter((job) => {
      const action = selectedActions[job.job_number] ?? defaultAction(job);
      return action === "Add" && unresolvedCorrections(job).length > 0;
    });
    if (blocked.length > 0) {
      // No discard/reject action exists yet for a proposed correction - only
      // apply. So the only way past this today is Apply, or switch the job's
      // action to Cancel. Don't imply a "discard" option that isn't there.
      setError(
        `Apply the proposed correction(s) on job ${blocked.map((j) => j.job_number).join(", ")} before processing as Add - otherwise the RPA would fill in the old, uncorrected values.`
      );
      return;
    }
    setProcessing(true);
    setError("");
    try {
      for (const job of pendingJobs) {
        const action: ManifestAction = selectedActions[job.job_number] ?? defaultAction(job);
        const source: "suggested" | "override" = job.suggested_action === action ? "suggested" : "override";
        const res = await fetch("/api/manifests/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_number: job.job_number, message_id: job.message_id, action, source }),
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
              <PdfViewer pdfUrl={pdfUrl} />
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
                  selectedAction={selectedActions[row.job_number] ?? defaultAction(row.job)}
                  expanded={expandedJob === row.job_number}
                  onSelectAction={(action) => selectAction(row.job_number, action)}
                  onToggleExpand={() => setExpandedJob((prev) => (prev === row.job_number ? null : row.job_number))}
                  pendingChanges={jobPendingChanges(row.job)}
                  onCorrectionChanged={() => refetchPendingChanges(row.job_number)}
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
            {/* Was "Mark as handled" (commit 03ffcfa, 2026-08-19), then "Save N decisions" —
                both hedged on the reasoning that "Process" would overstate what clicking it
                does. That stopped being true the very next day (commit 18ac127, 2026-08-20,
                firmin/agent.py's run_pending_client_portal_rpa): any job saved here with
                action Add is picked up by the live poll loop within ~60s and run through
                the real Client Portal RPA (fills the form, screenshots, does not submit).
                Renamed to "Process N orders" 2026-08-30 (George: most legible wording for
                admin staff). Update and Ignore removed 2026-08-31 (George: no order-
                amendment path into Proteo exists, so Update never meant anything; Ignore's
                job — "skip, already handled" — is now the seen-before badge, not a
                separate action) — Cancel still triggers nothing, that remains a human's
                job in Proteo. The helper text below reflects this now; don't let it drift
                out of sync with agent.py again. */}
            <button
              onClick={handleProcess}
              disabled={processing || pendingJobs.length === 0}
              className="w-full py-2.5 rounded-sm font-bold text-sm transition-colors disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              {processing
                ? "Processing…"
                : pendingJobs.length === 0
                  ? "All orders processed"
                  : `Process ${pendingJobs.length} order${pendingJobs.length === 1 ? "" : "s"}`}
            </button>
            <div className="text-[10px] mt-1.5 leading-snug text-center" style={{ color: "var(--label)" }}>
              Records your decision on each order. Add jobs trigger the Client Portal RPA
              automatically (fills the form, screenshot only — never submits). Cancel
              still needs applying by hand in Proteo.
            </div>
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
  const [search, setSearch] = useState("");
  const [showRecipients, setShowRecipients] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cheap probe, not a real capability check — the admin route is the actual
  // gate (403s for anyone not on the allowlist). This only decides whether
  // to show the link at all, so a non-admin never even sees it exists.
  const [isAdminUser, setIsAdminUser] = useState(false);
  useEffect(() => {
    fetch("/api/admin/summary").then((res) => setIsAdminUser(res.status !== 403)).catch(() => {});
  }, []);

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
  const filtered = filter === "new" ? newManifests : processedManifests;

  // The list row only ever showed the email subject line, not job numbers —
  // there was no way to find a specific job without already knowing which
  // email it arrived on (confirmed real 2026-08-26: couldn't locate a known
  // job number by scrolling the Pending tab by eye). Matches job number,
  // order number, or subject, across whichever tab is active.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((m) =>
      (m.subject || "").toLowerCase().includes(q) ||
      m.jobs.some((j) => j.job_number.toLowerCase().includes(q) || j.order_number.toLowerCase().includes(q)),
    );
  }, [filtered, search]);

  useEffect(() => {
    if (visible.length === 0) { setSelectedId(null); return; }
    if (!visible.some((m) => m.message_id === selectedId)) setSelectedId(visible[0].message_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Open straight onto one manifest from the notification email's link.
  //
  // ?job=<job_number> is what notifications now send, and it is preferred
  // because message_id is NOT a stable identity for a manifest — a job's row
  // gets re-keyed onto whichever email last touched it (DS Smith re-send the
  // same growing PDF, and sheet backfills stamp historical ids back over
  // current ones), so ?m= links were being invalidated within seconds of being
  // emailed. Job numbers are the primary key and never move.
  //
  // ?m= is still honoured for links already sent and for URLs copied out of
  // the address bar.
  //
  // Declared AFTER the auto-select effect above on purpose: both run in the
  // same flush once manifests land, and the later setSelectedId wins,
  // otherwise auto-select would immediately bounce us to visible[0].
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || manifests.length === 0) return;
    deepLinkApplied.current = true;

    const params = new URLSearchParams(window.location.search);
    const wantedJob = params.get("job");
    const wantedMsg = params.get("m");

    const target =
      (wantedJob && manifests.find((m) => m.jobs.some((j) => j.job_number === wantedJob))) ||
      (wantedMsg && manifests.find((m) => m.message_id === wantedMsg)) ||
      null;
    if (!target) return;  // stale or wrong-client link — leave the default view alone

    // A linked manifest is often already processed by the time someone clicks
    // through from their inbox, so land on whichever tab actually holds it.
    setFilter(isPending(target) ? "new" : "processed");
    // target.message_id, not the raw param — with ?job= the two differ.
    setSelectedId(target.message_id);
  }, [manifests]);

  // Keep the address bar in step with the selection so the URL is always
  // shareable/copyable. replaceState, not pushState — clicking through a list
  // shouldn't stack up dozens of back-button entries.
  useEffect(() => {
    if (!selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("m") === selectedId) return;
    url.searchParams.set("m", selectedId);
    // Drop ?job= once resolved, so the URL is canonical and copying it out of
    // the address bar can't hand someone a stale job pointer.
    url.searchParams.delete("job");
    window.history.replaceState(null, "", url);
  }, [selectedId]);

  const selected = visible.find((m) => m.message_id === selectedId) ?? null;

  function handleProcessed(messageId: string, jobNumbers: string[]) {
    setManifests((prev) => prev.map((m) => {
      if (m.message_id !== messageId) return m;
      return {
        ...m,
        // Optimistic placeholder only — the real value lands from the
        // refetch below. Add, not a "did nothing" default: there's no safe
        // silent-skip action anymore (Ignore was removed), and this is
        // overwritten within moments anyway.
        jobs: m.jobs.map((j) => (j.review_action ? j : { ...j, review_action: "Add" as ManifestAction })),
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
          {isAdminUser && (
            <a
              href="/admin"
              className="text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-sm"
              style={{ border: "1px solid var(--rule)", color: "var(--ink-soft)" }}
            >
              Admin
            </a>
          )}
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
            <div className="shrink-0 px-3 py-2" style={{ borderBottom: "1px solid var(--rule)" }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find by job number, order number, or subject…"
                className="w-full text-xs px-2.5 py-1.5 rounded-sm"
                style={{ border: "1px solid var(--rule)", background: "var(--paper)", color: "var(--ink)" }}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--label)" }}>
                  {search.trim()
                    ? "No match in this tab."
                    : filter === "new" ? "Nothing waiting for review." : "Nothing recorded yet."}
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
              {filter === "new" ? "Nothing waiting for review." : "Select a manifest to view it."}
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
