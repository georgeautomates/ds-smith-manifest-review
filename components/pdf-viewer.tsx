"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Google Drive's own /preview iframe viewer always fits the page to the
// container's HEIGHT and centers it, padding the rest with solid black -
// confirmed live 2026-08-30 across zoom fragments, embed params, and both
// Drive viewer variants, none of which change this. Wide/short panels (the
// shape of this dashboard's booking-form pane) always show black bars with
// that viewer. Rendering the PDF ourselves is the only way to actually fill
// the panel width edge-to-edge with no padding.
function driveFileId(url: string): string | null {
  const m = url.match(/\/file\/d\/([\w-]+)/);
  return m ? m[1] : null;
}

export function PdfViewer({ pdfUrl }: { pdfUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);

  const fileId = driveFileId(pdfUrl);

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

  // Keyed on fileId, not the whole pdfUrl, so switching between manifests
  // that share the same underlying attachment (common - DS Smith often
  // sends one PDF covering many jobs/manifests) doesn't re-fetch or reset
  // the page the reviewer is on.
  useEffect(() => {
    if (!fileId) {
      setError("Couldn't read this PDF's Drive file id");
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
        const loaded = await pdfjs.getDocument({ url: `/api/pdf-proxy?id=${encodeURIComponent(fileId)}` }).promise;
        if (cancelled) return;
        setDoc(loaded);
        setNumPages(loaded.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PDF");
      }
    })();
    return () => { cancelled = true; };
  }, [fileId]);

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
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to render page");
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
