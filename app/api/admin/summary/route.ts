import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/identity";
import { getRecentRpaRuns, getRecentPipelineRuns, getRecentReviewActions, getAgentHeartbeats } from "@/lib/db";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
  }

  try {
    const [rpaRuns, pipelineRuns, reviewActions, agentHeartbeats] = await Promise.all([
      getRecentRpaRuns(),
      getRecentPipelineRuns(),
      getRecentReviewActions(),
      getAgentHeartbeats(),
    ]);
    return NextResponse.json({ ok: true, rpaRuns, pipelineRuns, reviewActions, agentHeartbeats });
  } catch (e) {
    console.error("[api/admin/summary]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
