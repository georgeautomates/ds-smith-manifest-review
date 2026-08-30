import { NextRequest } from "next/server";

/**
 * Real, server-verified reviewer identity, from Azure Container Apps'
 * built-in authentication (Easy Auth). Once "Require authentication" is
 * turned on for this container app, every request that reaches the app has
 * already been through Microsoft's own sign-in — the auth sidecar injects
 * the signed-in user's UPN/email into X-MS-CLIENT-PRINCIPAL-NAME before
 * forwarding the request here. External callers cannot set this header
 * themselves; Container Apps strips and overwrites it, so its presence is
 * proof the request passed through the sidecar.
 *
 * Easy Auth is confirmed live as of 2026-08-30 — the client no longer sends
 * proposed_by/applied_by/reviewed_by at all (the old prompt()-based
 * lib/reviewer.ts stopgap was removed). Called from the API routes (server
 * side), not client components — headers are only readable there.
 *
 * https://learn.microsoft.com/en-us/azure/container-apps/authentication#access-user-claims-in-application-code
 *
 * unverifiedFallback: kept as a defensive fallback for local dev, where no
 * Easy Auth sidecar is present to inject the header. Production always has
 * the header, so this branch is never reached there.
 */
export function getVerifiedReviewerEmail(req: NextRequest, unverifiedFallback?: string): string {
  const verified = req.headers.get("x-ms-client-principal-name");
  if (verified) return verified;
  return unverifiedFallback ?? "";
}

// Admin/system-log access — Paul, Omi, Ayon, George only (2026-08-27). Real
// trustfirmin.com accounts, checked against the same verified Easy Auth
// header as everything else here — no fallback, since this is the one place
// in the app that gates on identity rather than just recording it. Anyone
// else signed in (a reviewer using the normal dashboard) gets no admin
// link and a 403 if they hit the route directly.
const ADMIN_EMAILS = new Set([
  "tomio-dev-admin@trustfirmin.com",
  "tayon-dev-admin@trustfirmin.com",
  "gspain-warner@trustfirmin.com",
  "pdenyer@trustfirmin.com",
]);

export function isAdmin(req: NextRequest): boolean {
  const verified = req.headers.get("x-ms-client-principal-name");
  if (!verified) return false;
  return ADMIN_EMAILS.has(verified.trim().toLowerCase());
}
