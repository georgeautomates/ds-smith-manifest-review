import { NextRequest, NextResponse } from "next/server";
import { saveManifestAction, type ManifestAction } from "@/lib/db";
import { getVerifiedReviewerEmail } from "@/lib/identity";

const VALID_ACTIONS: ManifestAction[] = ["Add", "Update", "Cancel", "Ignore"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { job_number, action, source, reviewed_by } = body ?? {};

    if (!job_number || typeof job_number !== "string") {
      return NextResponse.json({ ok: false, error: "job_number is required" }, { status: 400 });
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ ok: false, error: `action must be one of ${VALID_ACTIONS.join(", ")}` }, { status: 400 });
    }
    if (source !== "suggested" && source !== "override") {
      return NextResponse.json({ ok: false, error: 'source must be "suggested" or "override"' }, { status: 400 });
    }

    // Server-verified identity when Easy Auth is live; falls back to the
    // client-supplied value only during the transition — see lib/identity.ts.
    // Matches this route's original leniency: reviewed_by may end up blank,
    // unlike correction/apply below, which require a real identity.
    const reviewedBy = getVerifiedReviewerEmail(req, typeof reviewed_by === "string" ? reviewed_by : "");

    await saveManifestAction({
      job_number,
      action,
      source,
      reviewed_by: reviewedBy,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/manifests/action]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
