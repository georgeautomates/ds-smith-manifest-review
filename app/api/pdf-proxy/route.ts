import { NextRequest, NextResponse } from "next/server";

/**
 * Streams a booking-form PDF's raw bytes through our own origin so the
 * client can render it with pdf.js instead of a native browser/iframe
 * viewer (Drive's own /preview letterboxes wide/short panels with black
 * bars - no URL fragment fixes it, confirmed live 2026-08-30).
 *
 * Accepts EITHER a Drive file id (?id=) or an Azure Blob Storage URL
 * (?url=) — pdf_url can point at either backend during the 2026-09-30
 * Drive->Blob migration (see firmin/clients/blob.py's own docstring for
 * why: real, repeated Drive upload failures traced to this environment's
 * egress route forcing all outbound traffic through a firewall/NVA).
 * Historic rows get backfilled to Blob, but never accepts an arbitrary
 * caller-supplied URL for either source — only a bare Drive file id, or a
 * URL matching our own known storage account's host — to avoid becoming an
 * open proxy.
 *
 * Retries transient fetch failures a few times with a short backoff and an
 * explicit timeout — this read path had NONE before 2026-09-30, unlike the
 * write side (firmin/clients/drive.py's own upload retry logic), which is
 * the direct explanation for the "couldn't fetch PDF, works after a reload"
 * symptom George and the user both hit: a single flaky connection attempt
 * had nothing standing between it and a hard error shown to the reviewer.
 */
const FETCH_RETRIES = 3;
const RETRY_BACKOFF_MS = 400;
const FETCH_TIMEOUT_MS = 15000;

// Matches https://<account>.blob.core.windows.net/... — the only external
// host this route will ever fetch on the caller's behalf besides Drive.
const BLOB_HOST_RE = /^https:\/\/[\w-]+\.blob\.core\.windows\.net\//;

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) return res;
        lastError = new Error(`upstream responded ${res.status}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      lastError = e;
    }
    if (attempt < FETCH_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const blobUrl = req.nextUrl.searchParams.get("url");

  let upstreamUrl: string;
  if (blobUrl) {
    if (!BLOB_HOST_RE.test(blobUrl)) {
      return NextResponse.json({ error: "Invalid or untrusted PDF url" }, { status: 400 });
    }
    upstreamUrl = blobUrl;
  } else if (id) {
    if (!/^[\w-]{10,}$/.test(id)) {
      return NextResponse.json({ error: "Invalid or missing Drive file id" }, { status: 400 });
    }
    upstreamUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download`;
  } else {
    return NextResponse.json({ error: "Missing id or url parameter" }, { status: 400 });
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetchWithRetry(upstreamUrl);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF fetch failed after retries: ${message}` }, { status: 502 });
  }

  if (!upstreamRes.body) {
    return NextResponse.json({ error: "PDF fetch returned no body" }, { status: 502 });
  }

  return new NextResponse(upstreamRes.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=300",
    },
  });
}
