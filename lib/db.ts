import { Pool } from "pg";

// ── Connection ────────────────────────────────────────────────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.SUPABASE_POSTGRES_DSN, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

// ── Types ────────────────────────────────────────────────────────────────────

// Only two real actions exist: Add (enter it in the Client Portal — covers
// a genuinely new order, one whose data changed, AND one that matches what's
// on file but was never actually RPA'd) and Cancel (handled manually in
// Proteo, never touched by this app). Update and Ignore were removed —
// there's no order-amendment path into Proteo from here, and "seen before"
// is now shown directly via a badge (see getJobOccurrences) rather than a
// suggested_action value silently steering a reviewer away from an order.
//
// "Cancel" is displayed to reviewers as "Ignore" (app/page.tsx's
// ACTION_LABEL, added 2026-09-01 per George) — the button only records a
// decision here, it doesn't touch Proteo, so "Cancel" read as if the system
// cancelled the order. This string value stays "Cancel" everywhere it's
// stored/queried (RPA pickup, SQA, existing rows) — display-only rename.
export type ManifestAction = "Add" | "Cancel";
// What the classifier proposes — a superset of ManifestAction. "Review" means
// the classifier isn't confident enough to suggest a real action (e.g. a
// reply-chain email, not a clean new order/amendment) — the reviewer must
// still pick one of the two real ManifestAction values themselves.
export type SuggestedAction = ManifestAction | "Review";

// A field a reviewer is allowed to propose a correction for. Deliberately an
// allowlist, not free-text field names — keeps corrections to fields the UI
// actually knows how to render a diff for, and stops a malformed request from
// writing an arbitrary key into pending_changes.
export const CORRECTABLE_FIELDS = [
  "collection_point", "collection_postcode", "delivery_point", "delivery_postcode",
  "price", "order_number", "collection_date", "collection_time",
  "delivery_date", "delivery_time", "work_type", "booking_window", "traffic_note",
] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

// One entry in pending_changes: either a system-detected diff (a re-read PDF
// disagrees with a job already on file — the pipeline skips re-writing a
// seen job, so the stored row goes stale) or a reviewer's proposed
// correction. Same shape for both; source tells them apart. proposed_by/
// applied_by/proposed_at/applied_at/reason only apply to human_correction —
// a system_resend diff has no human on either side of it.
export type PendingChange = {
  field: string;
  previous: string;
  current: string;
  source?: "system_resend" | "human_correction";
  proposed_by?: string;
  proposed_at?: string;
  applied_by?: string;
  applied_at?: string;
  reason?: string;
};

export type ManifestJob = {
  job_number: string;
  client_name: string;
  message_id: string;
  processed_at: string;
  pdf_url: string;
  pdf_job_numbers: string[];
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
  work_type: string;
  booking_window: string;
  traffic_note: string;
  composite_score: string;
  confidence_status: string;
  email_subject: string;
  email_received_at: string;
  email_body: string;
  suggested_action: SuggestedAction | "";
  suggested_reason: string;
  review_action: ManifestAction | "";
  review_action_source: "suggested" | "override" | "";
  review_action_by: string;
  review_action_at: string;
  pending_changes: PendingChange[];
};

export type Manifest = {
  message_id: string;
  subject: string;
  email_received_at: string;
  processed_at: string;
  client_group: string;
  jobs: ManifestJob[];
  pending_count: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJob(r: Record<string, any>): ManifestJob {
  return {
    job_number: String(r.job_number ?? ""),
    client_name: String(r.client_name ?? ""),
    message_id: String(r.message_id ?? ""),
    processed_at: r.processed_at ? String(r.processed_at) : "",
    pdf_url: String(r.pdf_url ?? ""),
    pdf_job_numbers: Array.isArray(r.pdf_job_numbers) ? r.pdf_job_numbers.map(String) : [],
    collection_point: String(r.collection_point ?? ""),
    collection_postcode: String(r.collection_postcode ?? ""),
    delivery_point: String(r.delivery_point ?? ""),
    delivery_postcode: String(r.delivery_postcode ?? ""),
    price: String(r.price ?? ""),
    order_number: String(r.order_number ?? ""),
    collection_date: String(r.collection_date ?? ""),
    collection_time: String(r.collection_time ?? ""),
    delivery_date: String(r.delivery_date ?? ""),
    delivery_time: String(r.delivery_time ?? ""),
    work_type: String(r.work_type ?? ""),
    booking_window: String(r.booking_window ?? ""),
    traffic_note: String(r.traffic_note ?? ""),
    composite_score: r.composite_score != null ? String(r.composite_score) : "",
    confidence_status: String(r.confidence_status ?? ""),
    email_subject: String(r.email_subject ?? ""),
    email_received_at: String(r.email_received_at ?? ""),
    email_body: String(r.email_body ?? ""),
    suggested_action: (r.suggested_action as SuggestedAction) || "",
    suggested_reason: String(r.suggested_reason ?? ""),
    review_action: (r.review_action as ManifestAction) || "",
    review_action_source: (r.review_action_source as "suggested" | "override") || "",
    review_action_by: String(r.review_action_by ?? ""),
    review_action_at: r.review_action_at ? String(r.review_action_at) : "",
    pending_changes: Array.isArray(r.pending_changes) ? (r.pending_changes as PendingChange[]) : [],
  };
}

/**
 * processed_at / email_received_at are stored as free-text (not a real
 * timestamp column), in two different Date.toString()-ish formats. A plain
 * string sort on them is lexicographic, not chronological — e.g. "Wed May 27"
 * vs "Thu Jun 5" sorts by the letter W vs T, not by actual date. Parse to
 * real Date objects instead. Prefers email_received_at (when DS Smith
 * actually sent the manifest) over processed_at (when our pipeline happened
 * to write the row) since that's the more meaningful "recency" for a reviewer.
 */
function recencyTimestamp(m: Manifest): number {
  const received = m.email_received_at ? Date.parse(m.email_received_at) : NaN;
  if (!Number.isNaN(received)) return received;
  const processed = m.processed_at ? Date.parse(m.processed_at) : NaN;
  return Number.isNaN(processed) ? 0 : processed;
}

function byMostRecent(a: Manifest, b: Manifest): number {
  return recencyTimestamp(b) - recencyTimestamp(a);
}

function clientGroup(clientName: string): string {
  const n = clientName.toLowerCase();
  if (n.includes("reels")) return "Reels";
  if (n.includes("fibre")) return "Fibre";
  return clientName || "Unknown";
}

function buildManifest(msgId: string, jobs: ManifestJob[]): Manifest {
  const first = jobs[0];
  return {
    message_id: msgId,
    subject: first.email_subject,
    email_received_at: first.email_received_at,
    processed_at: first.processed_at,
    client_group: clientGroup(first.client_name),
    jobs,
    pending_count: jobs.filter(j => !j.review_action).length,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

// Temporary UI-only exclusion — hides this session's own test replay
// manifest from the dashboard so tomorrow's real DS Smith traffic isn't
// cluttered by it. Data untouched, nothing else affected; safe to remove
// this array (and its use below) once no longer needed.
const HIDDEN_MESSAGE_IDS: string[] = [
  "AAMkAGFlMGY1OTU0LTZiMzAtNGM1Ny05ZTJhLTllYmNmMTI4ZTI5ZABGAAAAAABB74Gg7YX0Q66BvBJLDp_uBwCLTVhQkYP3QLBlmY7M8-SKAAAAAAEMAACLTVhQkYP3QLBlmY7M8-SKAACsmgMUAAA=",
];

const SELECT_COLS = `
  job_number, client_name, message_id, processed_at, pdf_url, pdf_job_numbers,
  collection_point, collection_postcode, delivery_point, delivery_postcode,
  price, order_number,
  collection_date, collection_time, delivery_date, delivery_time,
  work_type, booking_window, traffic_note, composite_score, confidence_status,
  email_subject, email_received_at, email_body,
  suggested_action, suggested_reason,
  review_action, review_action_source, review_action_by, review_action_at,
  pending_changes
`;

/** Manifests with at least one job still awaiting a reviewer decision. Most recent first. */
export async function getPendingManifests(): Promise<Manifest[]> {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT ${SELECT_COLS} FROM st_regis_orders
    WHERE message_id IN (
      SELECT message_id FROM st_regis_orders
      WHERE (client_name ILIKE '%st regis%' OR client_name ILIKE '%ds smith%')
        AND (review_action IS NULL OR review_action = '')
    )
  `);
  // Row order from Postgres is irrelevant here — processed_at/email_received_at
  // are TEXT, not real timestamps, so any ORDER BY on them would be a
  // lexicographic string sort, not chronological. Final ordering happens
  // below via byMostRecent() on parsed Date values, after grouping by manifest.

  const byMessage: Record<string, ManifestJob[]> = {};
  for (const row of rows) {
    const job = rowToJob(row);
    if (HIDDEN_MESSAGE_IDS.includes(job.message_id)) continue;
    if (!byMessage[job.message_id]) byMessage[job.message_id] = [];
    byMessage[job.message_id].push(job);
  }
  return Object.entries(byMessage)
    .map(([msgId, jobs]) => buildManifest(msgId, jobs))
    .sort(byMostRecent);
}

/** All manifests regardless of review state, for the "reviewed" archive view. Most recent first. */
export async function getAllManifests(): Promise<Manifest[]> {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT ${SELECT_COLS} FROM st_regis_orders
    WHERE client_name ILIKE '%st regis%' OR client_name ILIKE '%ds smith%'
  `);

  const byMessage: Record<string, ManifestJob[]> = {};
  for (const row of rows) {
    const job = rowToJob(row);
    if (HIDDEN_MESSAGE_IDS.includes(job.message_id)) continue;
    if (!byMessage[job.message_id]) byMessage[job.message_id] = [];
    byMessage[job.message_id].push(job);
  }
  return Object.entries(byMessage)
    .map(([msgId, jobs]) => buildManifest(msgId, jobs))
    .sort(byMostRecent);
}

export async function getManifestByMessageId(messageId: string): Promise<Manifest | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM st_regis_orders WHERE message_id = $1 ORDER BY job_number`,
    [messageId]
  );
  if (rows.length === 0) return null;
  return buildManifest(messageId, rows.map(rowToJob));
}

export type OtherJob = {
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
};

/**
 * Job numbers found in a PDF but not part of the given manifest's own job
 * list — i.e. jobs DS Smith included on the same booking-form attachment
 * that were already ingested from an earlier email and so were dropped by
 * dedup before reaching this manifest. Looked up by job number across the
 * whole table (not scoped to message_id) since that's exactly where an
 * already-seen job would have been written. Pulls the same extracted fields
 * as a manifest's own jobs so the reviewer can see real order detail, not
 * just a bare job number, for every job printed on the form.
 */
export async function getKnownJobs(jobNumbers: string[]): Promise<OtherJob[]> {
  if (jobNumbers.length === 0) return [];
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT job_number, message_id, review_action, review_action_by, review_action_at,
            collection_point, collection_postcode, delivery_point, delivery_postcode,
            price, order_number, collection_date, collection_time, delivery_date, delivery_time,
            email_subject
     FROM st_regis_orders WHERE job_number = ANY($1)`,
    [jobNumbers]
  );
  return rows.map((r) => ({
    job_number: String(r.job_number ?? ""),
    message_id: String(r.message_id ?? ""),
    review_action: (r.review_action as ManifestAction) || "",
    review_action_by: String(r.review_action_by ?? ""),
    review_action_at: r.review_action_at ? String(r.review_action_at) : "",
    collection_point: String(r.collection_point ?? ""),
    collection_postcode: String(r.collection_postcode ?? ""),
    delivery_point: String(r.delivery_point ?? ""),
    delivery_postcode: String(r.delivery_postcode ?? ""),
    price: String(r.price ?? ""),
    order_number: String(r.order_number ?? ""),
    collection_date: String(r.collection_date ?? ""),
    collection_time: String(r.collection_time ?? ""),
    delivery_date: String(r.delivery_date ?? ""),
    delivery_time: String(r.delivery_time ?? ""),
    email_subject: String(r.email_subject ?? ""),
  }));
}

export type JobOccurrence = {
  job_number: string;
  message_id: string;
  email_subject: string;
  processed_at: string;
  review_action: ManifestAction | "";
  review_action_at: string;
  rpa_processed: boolean;
  rpa_processed_at: string;
};

/**
 * Every past sighting of one job_number, newest first — every email it's
 * ever appeared in, with whether each occurrence has genuinely gone through
 * the Client Portal RPA (from rpa_entry_mirror, a Postgres mirror of the
 * real RPA Entry Google Sheet — see firmin/verification.py's
 * ClientPortalRpaPipeline._write_row(); this Next.js app has no path to
 * read the Sheet directly). Backs the Manifest Review dashboard's "seen
 * before" badge — st_regis_orders' primary key is now the composite
 * (job_number, message_id), so a job_number can legitimately have several
 * rows, one per email.
 *
 * "rpa_processed" is deliberately NOT the same thing as "review_action is
 * set" — Cancel doesn't touch the RPA at all, and a reviewer clicking Add
 * doesn't guarantee the RPA has actually run yet (it fires on the agent's
 * next poll cycle). This only reflects a genuine completed RPA run.
 */
export async function getJobOccurrences(jobNumber: string): Promise<JobOccurrence[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT o.job_number, o.message_id, o.email_subject, o.processed_at,
            o.review_action, o.review_action_at,
            m.processed_at AS rpa_processed_at
     FROM st_regis_orders o
     LEFT JOIN LATERAL (
       SELECT processed_at
       FROM rpa_entry_mirror
       WHERE job_number = o.job_number AND success = true
       ORDER BY processed_at DESC
       LIMIT 1
     ) m ON true
     WHERE o.job_number = $1
     ORDER BY o.processed_at DESC`,
    [jobNumber]
  );
  return rows.map((r) => ({
    job_number: String(r.job_number ?? ""),
    message_id: String(r.message_id ?? ""),
    email_subject: String(r.email_subject ?? ""),
    processed_at: r.processed_at ? String(r.processed_at) : "",
    review_action: (r.review_action as ManifestAction) || "",
    review_action_at: r.review_action_at ? String(r.review_action_at) : "",
    rpa_processed: r.rpa_processed_at != null,
    rpa_processed_at: r.rpa_processed_at ? String(r.rpa_processed_at) : "",
  }));
}

export type ManifestActionDecision = {
  job_number: string;
  message_id: string;
  action: ManifestAction;
  source: "suggested" | "override";
  reviewed_by: string;
};

/**
 * Save the reviewer's Add/Update/Cancel/Ignore decision for one job.
 * Writes review_action only — never touches suggested_action/suggested_reason
 * (owned by firmin.clients.manifest_review, the Python classifier) or
 * manual_verdict/manual_reason (the separate PASS/FAIL accuracy audit on
 * st-regis-dashboard's /manager screen — a different table use entirely).
 *
 * Targets (job_number, message_id) together, not job_number alone —
 * st_regis_orders' primary key is now that composite pair, since DS Smith
 * resends the same job_number across genuinely separate emails and each
 * occurrence gets its own row. A job_number-only WHERE here would set
 * review_action on every occurrence at once, which is exactly the bug this
 * whole multi-occurrence change exists to fix: each occurrence must stay
 * independently actionable.
 */
export async function saveManifestAction(decision: ManifestActionDecision): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE st_regis_orders
     SET review_action = $1, review_action_source = $2, review_action_by = $3, review_action_at = now()
     WHERE job_number = $4 AND message_id = $5`,
    [decision.action, decision.source, decision.reviewed_by, decision.job_number, decision.message_id]
  );
}

// ── Field corrections ────────────────────────────────────────────────────────
//
// A reviewer flagging that one extracted field is wrong (or that Proteo's own
// value differs and the extraction should be trusted over it — see the price
// mismatches found during the 2026-08-20 QA pass, where the extraction turned
// out to be right and Proteo had the data-entry error). Two-step by design:
// propose (this only appends to pending_changes) then a separate apply writes
// the real column. Never overwrite collection_point/price/etc. directly from
// a correction — see document_pending_changes_human_correction_shape.sql for
// why that distinction matters.

export type ProposeCorrectionInput = {
  job_number: string;
  message_id: string;
  field: CorrectableField;
  current_value: string;
  new_value: string;
  reason: string;
  proposed_by: string;
};

// message_id required alongside job_number, same reasoning as
// saveManifestAction above — st_regis_orders' PK is the composite pair,
// so job_number alone could append this correction onto every occurrence
// of the job_number rather than the one specific occurrence being edited.
export async function proposeCorrection(input: ProposeCorrectionInput): Promise<void> {
  if (!input.reason.trim()) throw new Error("A reason is required for a correction");
  const pool = getPool();
  const change: PendingChange = {
    field: input.field,
    previous: input.current_value,
    current: input.new_value,
    source: "human_correction",
    proposed_by: input.proposed_by,
    proposed_at: new Date().toISOString(),
    applied_by: "",
    applied_at: "",
    reason: input.reason.trim(),
  };
  await pool.query(
    `UPDATE st_regis_orders
     SET pending_changes = pending_changes || $1::jsonb
     WHERE job_number = $2 AND message_id = $3`,
    [JSON.stringify([change]), input.job_number, input.message_id]
  );
}

export type ApplyCorrectionInput = {
  job_number: string;
  message_id: string;
  field: CorrectableField;
  // Identifies which pending_changes entry to apply — matched on
  // field + proposed_at, since a job can have more than one pending
  // correction on the same field over time.
  proposed_at: string;
  applied_by: string;
};

/**
 * Writes a previously-proposed correction into its real column, and marks
 * that pending_changes entry as applied (applied_by/applied_at) rather than
 * removing it — the proposal stays in the audit trail alongside the outcome.
 *
 * Both the read and the write are scoped to (job_number, message_id), not
 * job_number alone — same reasoning as saveManifestAction/proposeCorrection
 * above. Without message_id here, the SELECT could read an unrelated
 * occurrence's pending_changes (whichever row Postgres happens to return
 * first for a bare job_number match) and the UPDATE could apply the
 * correction onto every occurrence of the job_number at once.
 */
export async function applyCorrection(input: ApplyCorrectionInput): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT pending_changes FROM st_regis_orders WHERE job_number = $1 AND message_id = $2`,
    [input.job_number, input.message_id]
  );
  if (rows.length === 0) throw new Error(`No order found for job ${input.job_number}`);
  const changes: PendingChange[] = Array.isArray(rows[0].pending_changes) ? rows[0].pending_changes : [];
  const target = changes.find(
    (c) => c.field === input.field && c.proposed_at === input.proposed_at && c.source === "human_correction"
  );
  if (!target) throw new Error(`No matching pending correction for job ${input.job_number}, field ${input.field}`);
  if (target.applied_at) throw new Error(`Correction for job ${input.job_number}, field ${input.field} was already applied`);

  target.applied_by = input.applied_by;
  target.applied_at = new Date().toISOString();

  if (!CORRECTABLE_FIELDS.includes(input.field)) {
    throw new Error(`Field ${input.field} is not correctable`);
  }
  // input.field is validated against the allowlist above, so this identifier
  // interpolation is safe — never build this from unvalidated request input.
  await pool.query(
    `UPDATE st_regis_orders SET ${input.field} = $1, pending_changes = $2::jsonb WHERE job_number = $3 AND message_id = $4`,
    [target.current, JSON.stringify(changes), input.job_number, input.message_id]
  );
}

// ── Notification recipients ──────────────────────────────────────────────────
//
// Who gets the "new manifest waiting for review" email. Deliberately a table
// rather than an env var: the Firmin team need to add and remove people
// themselves, and an env var would mean a redeploy every time someone joins or
// leaves. Read by the Python agent at send time too, so this table is the one
// shared source of truth for the recipient list.

export type Recipient = {
  id: number;
  email: string;
  added_at: string;
};

export async function getRecipients(): Promise<Recipient[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, email, added_at FROM manifest_review_recipients ORDER BY email`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    added_at: r.added_at ? String(r.added_at) : "",
  }));
}

/** Idempotent — re-adding an existing address is a no-op, not an error. */
export async function addRecipient(email: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO manifest_review_recipients (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
    [email]
  );
}

export async function removeRecipient(id: number): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM manifest_review_recipients WHERE id = $1`, [id]);
}

// ── Admin / system log (read-only, gated by lib/identity.ts's isAdmin) ─────────

export type RpaRunSummary = {
  run_at: string;
  job_number: string;
  client_name: string;
  status: string;
  success: boolean | null;
  failed_step: string;
  duration_ms: number | null;
  error: string;
};

export async function getRecentRpaRuns(limit = 50): Promise<RpaRunSummary[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT run_at, job_number, client_name, status, success, failed_step, duration_ms, error
     FROM rpa_runs ORDER BY run_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    run_at: r.run_at ? String(r.run_at) : "",
    job_number: String(r.job_number ?? ""),
    client_name: String(r.client_name ?? ""),
    status: String(r.status ?? ""),
    success: r.success === null ? null : Boolean(r.success),
    failed_step: String(r.failed_step ?? ""),
    duration_ms: r.duration_ms === null ? null : Number(r.duration_ms),
    error: String(r.error ?? ""),
  }));
}

export type UnverifiedAddressRun = {
  run_at: string;
  job_number: string;
  client_name: string;
  side: "collection" | "delivery";
  point: string;
  address_typed: string;
  postcode: string;
};

/**
 * RPA fills where the portal's own location typeahead search found no match,
 * so the address got typed in from the extracted PDF data instead of a real
 * portal-verified record (firmin.clients.client_portal's typeahead_hit,
 * persisted per-run since 2026-08-31 as filled.entered_{side}_verified —
 * previously this only ever existed as a container log line, gone the
 * moment the log buffer rotated, so there was no way to tell a verified
 * fill from a guess after the fact).
 *
 * Reviewers never see the RPA screenshot (Drive-only, used for QA/training)
 * — they check the real portal directly. This is what they should glance at
 * before/while doing that: which of today's processed orders are worth a
 * closer look because the address wasn't confirmed against the portal's own
 * database. Only the most recent run per job/side, since an earlier failed
 * attempt superseded by a later successful one isn't actionable anymore.
 */
export async function getUnverifiedAddressRuns(limit = 100): Promise<UnverifiedAddressRun[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH latest_runs AS (
       SELECT DISTINCT ON (job_number) job_number, run_at, client_name, filled
       FROM rpa_runs
       WHERE filled IS NOT NULL
       ORDER BY job_number, run_at DESC
     )
     SELECT run_at, job_number, client_name, filled
     FROM latest_runs
     WHERE (filled->>'entered_collection_verified') = 'false'
        OR (filled->>'entered_delivery_verified') = 'false'
     ORDER BY run_at DESC
     LIMIT $1`,
    [limit]
  );
  const out: UnverifiedAddressRun[] = [];
  for (const r of rows) {
    const filled = r.filled ?? {};
    const run_at = r.run_at ? String(r.run_at) : "";
    const job_number = String(r.job_number ?? "");
    const client_name = String(r.client_name ?? "");
    if (filled.entered_collection_verified === false) {
      out.push({
        run_at, job_number, client_name, side: "collection",
        point: String(filled.entered_collection_point ?? ""),
        address_typed: String(filled.entered_collection_address1 ?? ""),
        postcode: String(filled.entered_collection_postcode ?? ""),
      });
    }
    if (filled.entered_delivery_verified === false) {
      out.push({
        run_at, job_number, client_name, side: "delivery",
        point: String(filled.entered_delivery_point ?? ""),
        address_typed: String(filled.entered_delivery_address1 ?? ""),
        postcode: String(filled.entered_delivery_postcode ?? ""),
      });
    }
  }
  return out;
}

export type PipelineRunSummary = {
  run_at: string;
  email_subject: string;
  client_name: string;
  status: string;
  job_count: number;
  jobs_written: number;
  jobs_skipped: number;
  jobs_failed: number;
  error: string;
};

export async function getRecentPipelineRuns(limit = 50): Promise<PipelineRunSummary[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT run_at, email_subject, client_name, status, job_count, jobs_written, jobs_skipped, jobs_failed, error
     FROM pipeline_runs ORDER BY run_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    run_at: r.run_at ? String(r.run_at) : "",
    email_subject: String(r.email_subject ?? ""),
    client_name: String(r.client_name ?? ""),
    status: String(r.status ?? ""),
    job_count: Number(r.job_count ?? 0),
    jobs_written: Number(r.jobs_written ?? 0),
    jobs_skipped: Number(r.jobs_skipped ?? 0),
    jobs_failed: Number(r.jobs_failed ?? 0),
    error: String(r.error ?? ""),
  }));
}

export type ReviewAuditEntry = {
  job_number: string;
  review_action: string;
  review_action_by: string;
  review_action_at: string;
};

export async function getRecentReviewActions(limit = 50): Promise<ReviewAuditEntry[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT job_number, review_action, review_action_by, review_action_at
     FROM st_regis_orders
     WHERE review_action_at IS NOT NULL
     ORDER BY review_action_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    job_number: String(r.job_number ?? ""),
    review_action: String(r.review_action ?? ""),
    review_action_by: String(r.review_action_by ?? ""),
    review_action_at: r.review_action_at ? String(r.review_action_at) : "",
  }));
}

export type AgentHeartbeat = {
  key: string;
  value: string;
  updated_at: string;
};

/** agent_state is the live VPS agent's own state table — a row only updates
 * while its polling loop is actually running, so recency here is a cheap
 * proxy for "is the agent alive" without needing a dedicated healthcheck. */
export async function getAgentHeartbeats(): Promise<AgentHeartbeat[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT key, value, updated_at FROM agent_state ORDER BY updated_at DESC`
  );
  return rows.map((r) => ({
    key: String(r.key ?? ""),
    value: String(r.value ?? ""),
    updated_at: r.updated_at ? String(r.updated_at) : "",
  }));
}
