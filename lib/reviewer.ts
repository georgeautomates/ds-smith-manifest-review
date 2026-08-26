// Stopgap identity capture — TRANSITIONAL ONLY as of 2026-08-26.
//
// Real auth is landing via Azure Container Apps Easy Auth (Ayon is waiting
// on Karl to create the Entra app registration — see the
// project_2026-08-21_next_session_auth memory). Once "Require
// authentication" is enabled on the container app, every request is
// already Microsoft-authenticated before it reaches this code, and the API
// routes (app/api/manifests/.../route.ts) read the real, unforgeable
// identity from the X-MS-CLIENT-PRINCIPAL-NAME header via
// lib/identity.ts's getVerifiedReviewerEmail() — this file's value is only
// used there as a fallback for as long as that header isn't present yet.
//
// Every write that records "who did this" (review_action_by, and the
// pending_changes proposed_by/applied_by) was previously always sent as ""
// — there was no session identity anywhere in either app. Rather than block
// on auth landing, this asks once per browser and remembers the answer, so
// the audit trail starts filling in now instead of staying permanently
// blank. It is spoofable (anyone can type any email) — that is exactly the
// gap Easy Auth closes; this file is not the security boundary once that
// lands, only the source of a display value for the client-side UI and the
// last-resort fallback server side.
//
// Deliberately stores an email, not a display name — matches the header
// Easy Auth injects, so once it lands, real logins and this stopgap's old
// entries line up on the same identifier.

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
