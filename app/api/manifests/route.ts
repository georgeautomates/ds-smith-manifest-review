import { NextResponse } from "next/server";
import { getPendingManifests } from "@/lib/db";

export async function GET() {
  try {
    const manifests = await getPendingManifests();
    return NextResponse.json({ manifests });
  } catch (e) {
    console.error("[api/manifests]", e);
    return NextResponse.json({ manifests: [], error: String(e) }, { status: 500 });
  }
}
