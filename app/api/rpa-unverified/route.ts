import { NextResponse } from "next/server";
import { getUnverifiedAddressRuns } from "@/lib/db";

export async function GET() {
  try {
    const runs = await getUnverifiedAddressRuns();
    return NextResponse.json({ runs });
  } catch (e) {
    console.error("[api/rpa-unverified]", e);
    return NextResponse.json({ runs: [], error: String(e) }, { status: 500 });
  }
}
