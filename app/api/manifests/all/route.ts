import { NextResponse } from "next/server";
import { getAllManifests } from "@/lib/db";

export async function GET() {
  try {
    const manifests = await getAllManifests();
    return NextResponse.json({ manifests });
  } catch (e) {
    console.error("[api/manifests/all]", e);
    return NextResponse.json({ manifests: [], error: String(e) }, { status: 500 });
  }
}
