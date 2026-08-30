import { NextRequest, NextResponse } from "next/server";

/**
 * Streams a Google Drive-hosted booking-form PDF's raw bytes through our own
 * origin so the client can render it with pdf.js instead of Drive's iframe
 * viewer (which letterboxes wide/short panels with black bars - no URL
 * fragment fixes it, confirmed live 2026-08-30). Only accepts a Drive file
 * id, never an arbitrary URL, to avoid becoming an open proxy.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[\w-]{10,}$/.test(id)) {
    return NextResponse.json({ error: "Invalid or missing Drive file id" }, { status: 400 });
  }

  const driveRes = await fetch(
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download`
  );
  if (!driveRes.ok || !driveRes.body) {
    return NextResponse.json({ error: `Drive fetch failed (${driveRes.status})` }, { status: 502 });
  }

  return new NextResponse(driveRes.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=300",
    },
  });
}
