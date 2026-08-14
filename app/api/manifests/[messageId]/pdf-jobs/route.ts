import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
// @ts-expect-error -- no types for this internal worker entry; see comment below
import * as pdfWorkerModule from "../../../../../node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs";
import { getManifestByMessageId, getKnownJobs } from "@/lib/db";

// pdfjs-dist (via pdf-parse) normally loads its worker with a *dynamic*
// import(runtimeStringPath) — Turbopack can't trace a string built at
// runtime, so that resolves to a broken path and every parse fails ("Setting
// up fake worker failed"). A *static* import of the same file (by relative
// filesystem path, since pdf-parse's package.json "exports" map blocks a
// package-specifier import into dist/) is statically analyzable by
// Turbopack and works — stash it on globalThis under the name pdfjs-dist
// checks first (PDFWorker.#mainThreadWorkerMessageHandler) so it
// short-circuits before ever attempting the dynamic import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).pdfjsWorker = { WorkerMessageHandler: (pdfWorkerModule as any).WorkerMessageHandler };

// Same pattern the Python pipeline uses to find DS Smith job numbers
// (firmin/clients/pdf.py: _JOB_RE) — 7 digits starting 25 or 26.
const JOB_NUMBER_RE = /\b(2[56]\d{5})\b/g;

function driveDownloadUrl(viewUrl: string): string | null {
  const match = viewUrl.match(/\/file\/d\/([^/]+)/);
  if (!match) return null;
  return `https://drive.google.com/uc?export=download&id=${match[1]}`;
}

/**
 * Job numbers present in this manifest's booking-form PDF but not in its own
 * job list — i.e. jobs on the same attachment that dedup already filed
 * against an earlier email. Lets the UI explain an "only 1 order" manifest
 * whose PDF visibly shows more.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await params;
    const manifest = await getManifestByMessageId(decodeURIComponent(messageId));
    if (!manifest) {
      return NextResponse.json({ error: "Manifest not found" }, { status: 404 });
    }

    const pdfUrl = manifest.jobs.find((j) => j.pdf_url)?.pdf_url ?? "";
    const downloadUrl = pdfUrl ? driveDownloadUrl(pdfUrl) : null;
    if (!downloadUrl) {
      return NextResponse.json({ otherJobs: [] });
    }

    const pdfRes = await fetch(downloadUrl);
    if (!pdfRes.ok) {
      return NextResponse.json({ otherJobs: [] });
    }
    const data = Buffer.from(await pdfRes.arrayBuffer());

    const parser = new PDFParse({ data });
    const result = await parser.getText();
    await parser.destroy();

    const ownJobNumbers = new Set(manifest.jobs.map((j) => j.job_number));
    const pdfJobNumbers = [...new Set(result.text.match(JOB_NUMBER_RE) ?? [])];
    const extraJobNumbers = pdfJobNumbers.filter((j) => !ownJobNumbers.has(j));

    const known = await getKnownJobs(extraJobNumbers);
    const knownByJob = new Map(known.map((k) => [k.job_number, k]));

    const otherJobs = extraJobNumbers.map((job_number) => {
      const found = knownByJob.get(job_number);
      return {
        job_number,
        message_id: found?.message_id ?? "",
        review_action: found?.review_action ?? "",
        found: Boolean(found),
      };
    });

    return NextResponse.json({ otherJobs });
  } catch (e) {
    console.error("[api/manifests/[messageId]/pdf-jobs]", e);
    return NextResponse.json({ otherJobs: [], error: String(e) }, { status: 500 });
  }
}
