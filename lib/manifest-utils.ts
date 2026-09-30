// Pure, dependency-free helpers shared between server code (lib/db.ts) and
// client components (app/page.tsx). Deliberately its own file, not just
// exported from lib/db.ts: db.ts imports `pg`, and `pg` pulls in Node
// built-ins (tls, util/types, ...) that don't exist in a browser bundle —
// importing ANYTHING from db.ts into a "use client" file drags the whole
// module graph along and breaks the client build, even if the specific
// export imported has no real dependency on `pg` itself. Confirmed real
// 2026-09-30 while adding the date filter to page.tsx: `next build` failed
// with "Module not found: Can't resolve 'tls'" the moment `recencyTimestamp`
// was imported from lib/db.ts client-side.

// Structural type, not `import type { Manifest }` — this needs to accept
// EITHER a Manifest or a bare ManifestJob (both carry these same two
// fields), e.g. lib/db.ts's markSupersededOccurrences() calls this directly
// on individual job rows, not just assembled manifests. A type-only import
// of ManifestJob from db.ts would be fine at compile time, but keeping this
// file's only coupling to db.ts structural (not a named import) avoids ever
// having to reason about it again if db.ts's exports change shape.
type HasRecencyFields = { email_received_at: string; processed_at: string };

/**
 * processed_at / email_received_at are stored as free-text (not a real
 * timestamp column), in two different Date.toString()-ish formats. A plain
 * string sort on them is lexicographic, not chronological — e.g. "Wed May 27"
 * vs "Thu Jun 5" sorts by the letter W vs T, not by actual date. Parse to
 * real Date objects instead. Prefers email_received_at (when DS Smith
 * actually sent the manifest) over processed_at (when our pipeline happened
 * to write the row) since that's the more meaningful "recency" for a reviewer.
 */
export function recencyTimestamp(m: HasRecencyFields): number {
  const received = m.email_received_at ? Date.parse(m.email_received_at) : NaN;
  if (!Number.isNaN(received)) return received;
  const processed = m.processed_at ? Date.parse(m.processed_at) : NaN;
  return Number.isNaN(processed) ? 0 : processed;
}

// YYYY-MM-DD in the VIEWER's own local timezone (not UTC, not the server's) —
// matches what an <input type="date"> both stores and expects, and matches
// what "today" means to the person actually looking at the screen.
export function localDateKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayDateKey(): string {
  return localDateKey(Date.now());
}
