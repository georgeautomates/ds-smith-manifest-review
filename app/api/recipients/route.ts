import { NextRequest, NextResponse } from "next/server";
import { getRecipients, addRecipient, removeRecipient } from "@/lib/db";

// Deliberately loose. This is an internal tool behind the same access as the
// rest of the dashboard, and an over-strict regex rejecting a valid corporate
// address is a worse failure here than accepting a typo the sender will bounce.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  try {
    const recipients = await getRecipients();
    return NextResponse.json({ ok: true, recipients });
  } catch (e) {
    console.error("[api/recipients GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const raw = body?.email;

    if (!raw || typeof raw !== "string") {
      return NextResponse.json({ ok: false, error: "email is required" }, { status: 400 });
    }
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: "that doesn't look like an email address" }, { status: 400 });
    }

    await addRecipient(email);
    return NextResponse.json({ ok: true, recipients: await getRecipients() });
  } catch (e) {
    console.error("[api/recipients POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const id = Number(body?.id);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "a numeric id is required" }, { status: 400 });
    }

    await removeRecipient(id);
    return NextResponse.json({ ok: true, recipients: await getRecipients() });
  } catch (e) {
    console.error("[api/recipients DELETE]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
