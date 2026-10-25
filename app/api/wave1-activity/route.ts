import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/identity";
import { getWave1Orders } from "@/lib/db";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
  }

  try {
    const orders = await getWave1Orders();
    return NextResponse.json({ ok: true, orders });
  } catch (e) {
    console.error("[api/wave1-activity]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
