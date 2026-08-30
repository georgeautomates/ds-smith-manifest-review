import { NextRequest, NextResponse } from "next/server";
import { getJobOccurrences } from "@/lib/db";

/**
 * Every past sighting of one job_number across every email it's ever
 * appeared in, with whether each occurrence genuinely went through the
 * Client Portal RPA. Backs the "seen before" badge on an order card —
 * fetched lazily, only when a reviewer expands the badge, not prefetched
 * for every row on the manifest.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobNumber: string }> }
) {
  try {
    const { jobNumber } = await params;
    const occurrences = await getJobOccurrences(decodeURIComponent(jobNumber));
    return NextResponse.json({ occurrences });
  } catch (e) {
    console.error("[api/manifests/job-occurrences/[jobNumber]]", e);
    return NextResponse.json({ occurrences: [], error: String(e) }, { status: 500 });
  }
}
