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

export type ManifestAction = "Add" | "Update" | "Cancel" | "Ignore";
// What the classifier proposes — a superset of ManifestAction. "Review" means
// the classifier isn't confident enough to suggest a real action (e.g. a
// reply-chain email, not a clean new order/amendment) — the reviewer must
// still pick one of the four real ManifestAction values themselves.
export type SuggestedAction = ManifestAction | "Review";

/** One field the re-read PDF disagrees with on a job already on file. */
export type PendingChange = { field: string; previous: string; current: string };

export type ManifestJob = {
  job_number: string;
  client_name: string;
  message_id: string;
  processed_at: string;
  pdf_url: string;
  pdf_job_numbers: string[];
  pending_changes: PendingChange[];
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
    pending_changes: Array.isArray(r.pending_changes) ? (r.pending_changes as PendingChange[]) : [],
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

const SELECT_COLS = `
  job_number, client_name, message_id, processed_at, pdf_url, pdf_job_numbers,
  pending_changes,
  collection_point, collection_postcode, delivery_point, delivery_postcode,
  price, order_number,
  collection_date, collection_time, delivery_date, delivery_time,
  work_type, booking_window, traffic_note, composite_score, confidence_status,
  email_subject, email_received_at, email_body,
  suggested_action, suggested_reason,
  review_action, review_action_source, review_action_by, review_action_at
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

export type ManifestActionDecision = {
  job_number: string;
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
 */
export async function saveManifestAction(decision: ManifestActionDecision): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE st_regis_orders
     SET review_action = $1, review_action_source = $2, review_action_by = $3, review_action_at = now()
     WHERE job_number = $4`,
    [decision.action, decision.source, decision.reviewed_by, decision.job_number]
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
