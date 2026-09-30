"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// Google Drive's own /preview iframe viewer always fits the page to the
// container's HEIGHT and centers it, padding the rest with solid black -
// confirmed live 2026-08-30 across zoom fragments, embed params, and both
// Drive viewer variants, none of which change this. Wide/short panels (the
// shape of this dashboard's booking-form pane) always show black bars with
// that viewer. Rendering the PDF ourselves is the only way to actually fill
// the panel width edge-to-edge with no padding.
//
// pdf_url can point at either backend during the 2026-09-30 Drive->Blob
// migration: historic rows get backfilled to Blob, but a row written by an
// agent revision mid-rollout, or one the backfill hasn't reached yet, can
// still carry a real drive.google.com link. /api/pdf-proxy is built to
// accept either source id, so this just needs to recognise which kind of
// URL it's looking at and extract the right identifier.
type PdfSource = { kind: "drive"; id: string } | { kind: "blob"; url: string };

function pdfSource(url: string): PdfSource | null {
  const driveMatch = url.match(/\/file\/d\/([\w-]+)/);
  if (driveMatch) return { kind: "drive", id: driveMatch[1] };
  if (/^https:\/\/[\w-]+\.blob\.core\.windows\.net\//.test(url)) return { kind: "blob", url };
  return null;
}

export function PdfViewer({ pdfUrl }: { pdfUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);

  const source = pdfSource(pdfUrl);

  // Track the panel's actual rendered width so pages re-render at the right
  // scale when the reviewer drags the resize handle.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyed on the source's own identifier, not the whole pdfUrl, so switching
  // between manifests that share the same underlying attachment (common -
  // DS Smith often sends one PDF covering many jobs/manifests) doesn't
  // re-fetch or reset the page the reviewer is on.
  const sourceKey = source ? (source.kind === "drive" ? source.id : source.url) : "";
  useEffect(() => {
    if (!source) {
      setError("Couldn't read this PDF's file location");
      setDoc(null);
      return;
    }
    let cancelled = false;
    setError("");
    setDoc(null);
    setPageNum(1);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const proxyUrl =
          source.kind === "drive"
            ? `/api/pdf-proxy?id=${encodeURIComponent(source.id)}`
            : `/api/pdf-proxy?url=${encodeURIComponent(source.url)}`;
        const loaded = await pdfjs.getDocument({ url: proxyUrl }).promise;
        if (cancelled) return;
        setDoc(loaded);
        setNumPages(loaded.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PDF");
      }
    })();
    return () => { cancelled = true; };
    // Deliberately NOT depending on `source` itself — pdfSource(pdfUrl)
    // returns a brand-new object literal every render, so including the
    // object reference here re-ran this effect (wiping and re-fetching the
    // PDF) on every single re-render of this component, not just when the
    // real underlying PDF changed. Confirmed live 2026-09-30: this caused a
    // visible flicker as the viewer kept clearing and reloading itself.
    // sourceKey is the derived, stable primitive that actually identifies
    // which PDF this is — same role fileId's plain string played before the
    // Drive/Blob refactor introduced this bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || !width) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        // Fill the panel's actual width edge-to-edge - the whole point of
        // rendering it ourselves instead of Drive's fit-to-height iframe.
        const scale = (width / unscaled.width) * (window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // A ResizeObserver firing mid-render (dragging the panel handle, or
        // the layout settling on mount) can start a second render() on this
        // same canvas before the first one finishes - pdf.js throws instead
        // of queueing. Cancelling the previous task via the ref (not just the
        // `cancelled` flag, which only skips OUR OWN post-render state
        // updates) is what actually stops that.
        renderTaskRef.current?.cancel();
        const task = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = task;
        await task.promise;
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      } catch (e) {
        const isCancel = e instanceof Error && e.name === "RenderingCancelledException";
        if (!cancelled && !isCancel) setError(e instanceof Error ? e.message : "Failed to render page");
      }
    })();
    return () => { cancelled = true; };
  }, [doc, pageNum, width]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center" style={{ background: "var(--paper-raised)" }}>
        <span className="text-sm" style={{ color: "var(--label)" }}>Couldn&apos;t display this PDF ({error})</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-auto" style={{ background: "var(--paper-raised)" }}>
      <canvas ref={canvasRef} className="block" />
      {numPages > 1 && (
        <div className="sticky bottom-0 flex items-center justify-center gap-3 py-2" style={{ background: "var(--paper-raised)", borderTop: "1px solid var(--rule)" }}>
          <button
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="text-xs px-2 py-1 rounded disabled:opacity-40"
            style={{ border: "1px solid var(--rule)" }}
          >
            Prev
          </button>
          <span className="text-xs" style={{ color: "var(--label)" }}>Page {pageNum} of {numPages}</span>
          <button
            onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            disabled={pageNum >= numPages}
            className="text-xs px-2 py-1 rounded disabled:opacity-40"
            style={{ border: "1px solid var(--rule)" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
