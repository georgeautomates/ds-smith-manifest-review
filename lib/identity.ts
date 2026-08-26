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
 * Replaces the client-supplied proposed_by/applied_by/reviewed_by fields
 * lib/reviewer.ts used to send, which came from a browser prompt() and
 * could not be trusted for anything beyond "no worse than a blank audit
 * trail." Called from the API routes (server side), not client components —
 * headers are only readable there.
 *
 * https://learn.microsoft.com/en-us/azure/container-apps/authentication#access-user-claims-in-application-code
 *
 * unverifiedFallback: TRANSITIONAL ONLY, remove once Easy Auth is confirmed
 * live (Ayon is waiting on Karl for the Entra app registration as of
 * 2026-08-26 — see project_2026-08-21_next_session_auth memory). Until then
 * the header is never present — nothing forwards it locally or in any
 * deployment that hasn't got Easy Auth turned on — so falling through to
 * the old prompt()-based value keeps the app usable rather than hard-403ing
 * every correction/action for the whole transition window. Once Easy Auth
 * is live the header is always present and this fallback is simply never
 * reached again; no second deploy is needed to "turn on" the real check.
 */
export function getVerifiedReviewerEmail(req: NextRequest, unverifiedFallback?: string): string {
  const verified = req.headers.get("x-ms-client-principal-name");
  if (verified) return verified;
  return unverifiedFallback ?? "";
}
