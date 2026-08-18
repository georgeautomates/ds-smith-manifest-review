import { NextRequest, NextResponse } from "next/server";
import { getManifestByMessageId, getKnownJobs } from "@/lib/db";

/**
 * Job numbers present on this manifest's booking-form PDF but not in its own
 * job list — i.e. jobs DS Smith included on the same attachment that dedup
 * already filed under an earlier email. pdf_job_numbers is computed once at
 * ingestion time by the Python pipeline (firmin/pipeline.py) and stored
 * directly on each row, so this is a plain DB lookup — no PDF parsing here.
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

    const ownJobNumbers = new Set(manifest.jobs.map((j) => j.job_number));
    const pdfJobNumbers = manifest.jobs.find((j) => j.pdf_job_numbers.length > 0)?.pdf_job_numbers ?? [];
    const extraJobNumbers = [...new Set(pdfJobNumbers)].filter((j) => !ownJobNumbers.has(j));

    const known = await getKnownJobs(extraJobNumbers);
    const knownByJob = new Map(known.map((k) => [k.job_number, k]));

    const otherJobs = extraJobNumbers.map((job_number) => {
      const found = knownByJob.get(job_number);
      return {
        job_number,
        message_id: found?.message_id ?? "",
        review_action: found?.review_action ?? "",
        review_action_by: found?.review_action_by ?? "",
        review_action_at: found?.review_action_at ?? "",
        collection_point: found?.collection_point ?? "",
        collection_postcode: found?.collection_postcode ?? "",
        delivery_point: found?.delivery_point ?? "",
        delivery_postcode: found?.delivery_postcode ?? "",
        price: found?.price ?? "",
        order_number: found?.order_number ?? "",
        collection_date: found?.collection_date ?? "",
        collection_time: found?.collection_time ?? "",
        delivery_date: found?.delivery_date ?? "",
        delivery_time: found?.delivery_time ?? "",
        email_subject: found?.email_subject ?? "",
        found: Boolean(found),
      };
    });

    return NextResponse.json({ otherJobs });
  } catch (e) {
    console.error("[api/manifests/[messageId]/pdf-jobs]", e);
    return NextResponse.json({ otherJobs: [], error: String(e) }, { status: 500 });
  }
}
