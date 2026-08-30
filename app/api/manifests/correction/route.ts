import { NextRequest, NextResponse } from "next/server";
import { proposeCorrection, CORRECTABLE_FIELDS, type CorrectableField } from "@/lib/db";
import { getVerifiedReviewerEmail } from "@/lib/identity";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { job_number, message_id, field, current_value, new_value, reason, proposed_by } = body ?? {};

    if (!job_number || typeof job_number !== "string") {
      return NextResponse.json({ ok: false, error: "job_number is required" }, { status: 400 });
    }
    if (!message_id || typeof message_id !== "string") {
      return NextResponse.json({ ok: false, error: "message_id is required" }, { status: 400 });
    }
    if (!CORRECTABLE_FIELDS.includes(field)) {
      return NextResponse.json({ ok: false, error: `field must be one of ${CORRECTABLE_FIELDS.join(", ")}` }, { status: 400 });
    }
    if (typeof new_value !== "string" || !new_value.trim()) {
      return NextResponse.json({ ok: false, error: "new_value is required" }, { status: 400 });
    }
    if (typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json({ ok: false, error: "reason is required" }, { status: 400 });
    }

    // Server-verified identity from Easy Auth — see lib/identity.ts.
    const proposedBy = getVerifiedReviewerEmail(req, typeof proposed_by === "string" ? proposed_by : "");
    if (!proposedBy) {
      return NextResponse.json({ ok: false, error: "proposed_by is required" }, { status: 400 });
    }

    await proposeCorrection({
      job_number,
      message_id,
      field: field as CorrectableField,
      current_value: typeof current_value === "string" ? current_value : "",
      new_value: new_value.trim(),
      reason: reason.trim(),
      proposed_by: proposedBy,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/manifests/correction]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
