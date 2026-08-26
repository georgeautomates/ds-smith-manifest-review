import { NextRequest, NextResponse } from "next/server";
import { applyCorrection, CORRECTABLE_FIELDS, type CorrectableField } from "@/lib/db";
import { getVerifiedReviewerEmail } from "@/lib/identity";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { job_number, field, proposed_at, applied_by } = body ?? {};

    if (!job_number || typeof job_number !== "string") {
      return NextResponse.json({ ok: false, error: "job_number is required" }, { status: 400 });
    }
    if (!CORRECTABLE_FIELDS.includes(field)) {
      return NextResponse.json({ ok: false, error: `field must be one of ${CORRECTABLE_FIELDS.join(", ")}` }, { status: 400 });
    }
    if (!proposed_at || typeof proposed_at !== "string") {
      return NextResponse.json({ ok: false, error: "proposed_at is required to identify which correction to apply" }, { status: 400 });
    }

    // Server-verified identity when Easy Auth is live; falls back to the
    // client-supplied value only during the transition — see lib/identity.ts.
    const appliedBy = getVerifiedReviewerEmail(req, typeof applied_by === "string" ? applied_by : "");
    if (!appliedBy) {
      return NextResponse.json({ ok: false, error: "applied_by is required" }, { status: 400 });
    }

    await applyCorrection({
      job_number,
      field: field as CorrectableField,
      proposed_at,
      applied_by: appliedBy,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/manifests/correction/apply]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
