import { NextRequest, NextResponse } from "next/server";
import { getManifestByMessageId } from "@/lib/db";

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
    return NextResponse.json({ manifest });
  } catch (e) {
    console.error("[api/manifests/[messageId]]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
