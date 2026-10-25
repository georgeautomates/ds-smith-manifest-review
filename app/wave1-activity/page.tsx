"use client";

import { useEffect, useState } from "react";
import type { Wave1Order } from "@/lib/db";

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  const bg = ok === null ? "var(--ignore-tint)" : ok ? "var(--add-tint)" : "var(--cancel-tint)";
  const fg = ok === null ? "var(--ignore)" : ok ? "var(--add)" : "var(--cancel)";
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: bg, color: fg }}>
      {label}
    </span>
  );
}

function submitState(o: Wave1Order): { ok: boolean | null; label: string } {
  if (!o.rpa_status) return { ok: null, label: "Not yet attempted" };
  const s = o.rpa_status.toLowerCase();
  if (s.includes("success") || s.includes("submit")) return { ok: true, label: o.rpa_status };
  return { ok: false, label: o.rpa_status };
}

export default function Wave1ActivityPage() {
  const [orders, setOrders] = useState<Wave1Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/wave1-activity")
      .then(async (res) => {
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setOrders(data.orders);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (forbidden) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm" style={{ color: "var(--label)" }}>This page is restricted to admin accounts.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm" style={{ color: "var(--cancel)" }}>{error}</p>
      </div>
    );
  }

  if (!orders) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm" style={{ color: "var(--label)" }}>Loading…</p>
      </div>
    );
  }

  const q = filter.trim().toLowerCase();
  const filtered = orders.filter(
    (o) =>
      q === "" ||
      o.job_number.toLowerCase().includes(q) ||
      o.client_name.toLowerCase().includes(q) ||
      o.email_subject.toLowerCase().includes(q)
  );

  const byClient = new Map<string, number>();
  for (const o of orders) byClient.set(o.client_name, (byClient.get(o.client_name) || 0) + 1);

  return (
    <div className="flex-1 flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Wave-1 Activity</h1>
        <p className="text-xs" style={{ color: "var(--label)" }}>
          Unipet, InContrast, AIM, Revolution Beauty, Eurocoils — email in, extracted, submitted. Read-only,
          admin accounts only. St Regis/DS Smith has its own review page above, not shown here.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {[...byClient.entries()].map(([name, count]) => (
          <span
            key={name}
            className="text-xs rounded-full px-2.5 py-1"
            style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", color: "var(--ink-soft)" }}
          >
            {name} <span style={{ color: "var(--label)" }}>{count}</span>
          </span>
        ))}
        {orders.length === 0 && <span className="text-sm" style={{ color: "var(--label)" }}>No orders yet.</span>}
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by job number, client, or subject…"
        className="w-full max-w-sm rounded-md px-3 py-1.5 text-sm outline-none"
        style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", color: "var(--ink)" }}
      />

      <div className="flex flex-col gap-2">
        {filtered.map((o) => {
          const key = `${o.job_number}-${o.message_id}`;
          const open = expanded === key;
          const submit = submitState(o);
          return (
            <div key={key} className="rounded-md overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
              <button
                onClick={() => setExpanded(open ? null : key)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left"
              >
                <StatusPill ok={submit.ok} label={submit.ok === false ? "Failed" : submit.ok ? "Submitted" : "Pending"} />
                <span className="font-mono" style={{ color: "var(--ink-soft)" }}>{o.job_number}</span>
                <span className="hidden sm:inline" style={{ color: "var(--label)" }}>{o.client_name}</span>
                <span className="ml-auto text-xs" style={{ color: "var(--label)" }}>{fmtDateTime(o.processed_at)}</span>
              </button>
              {open && (
                <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div className="sm:col-span-2 text-xs italic" style={{ color: "var(--label)" }}>
                    {o.client_name} — {o.email_subject || "—"}
                  </div>
                  <Field label="Collection" value={`${o.collection_point || "—"} ${o.collection_postcode ? `(${o.collection_postcode})` : ""}`} />
                  <Field label="Delivery" value={`${o.delivery_point || "—"} ${o.delivery_postcode ? `(${o.delivery_postcode})` : ""}`} />
                  <Field label="Collection date/time" value={`${o.collection_date || "—"} ${o.collection_time || ""}`} />
                  <Field label="Delivery date/time" value={`${o.delivery_date || "—"} ${o.delivery_time || ""}`} />
                  <Field label="Order number" value={o.order_number || "—"} />
                  <Field label="Price" value={o.price || "—"} />
                  <Field label="Extraction score" value={o.composite_score !== null ? `${o.composite_score} (${o.confidence_status})` : "—"} />
                  <Field
                    label="RPA submission"
                    value={`${submit.label}${o.rpa_error ? ` — ${o.rpa_error.slice(0, 120)}` : ""}${o.rpa_attempted_at ? ` (${fmtDateTime(o.rpa_attempted_at)})` : ""}`}
                  />
                  {o.pdf_url && (
                    <div className="sm:col-span-2 pt-1">
                      <a href={o.pdf_url} target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: "var(--add)" }}>
                        View source PDF
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--label)" }}>{label}</div>
      <div style={{ color: "var(--ink)" }}>{value}</div>
    </div>
  );
}
