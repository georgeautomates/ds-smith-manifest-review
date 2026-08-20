// Stopgap identity capture, ahead of real user/admin auth (planned next).
//
// Every write that records "who did this" (review_action_by, and the new
// pending_changes proposed_by/applied_by) was previously always sent as "" —
// there was no session identity anywhere in either app. Rather than block on
// auth landing, this asks once per browser and remembers the answer, so the
// audit trail starts filling in now instead of staying permanently blank.
//
// Deliberately stores an email, not a display name — a future auth migration
// can backfill a user_id by matching on email, which a free-text name can't
// support reliably.

const STORAGE_KEY = "firmin_reviewer_email";

export function getReviewerEmail(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) || "";
}

export function setReviewerEmail(email: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, email.trim());
}

/**
 * Returns the stored reviewer email, prompting for it once if none is set
 * yet. Call this immediately before any action that needs to record who
 * performed it (saveManifestAction, a correction, a PASS/FAIL verdict).
 *
 * Uses window.prompt rather than a modal component deliberately — this is a
 * stopgap ahead of real auth, not a feature worth its own UI. Replace the
 * whole module with a real session lookup once auth lands; every call site
 * that reads getReviewerEmail() keeps working unchanged.
 */
export function ensureReviewerEmail(): string {
  let email = getReviewerEmail();
  if (!email) {
    const entered = typeof window !== "undefined" ? window.prompt("Your email (for the review audit trail):") : null;
    if (entered && entered.trim()) {
      email = entered.trim();
      setReviewerEmail(email);
    }
  }
  return email;
}
