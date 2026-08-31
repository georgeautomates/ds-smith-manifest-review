"use client";

import { useEffect, useState } from "react";
import type { UnverifiedAddressRun } from "@/lib/db";

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-3 py-1.5 text-xs font-medium sticky top-0"
      style={{ color: "var(--label)", background: "var(--paper-raised)", borderBottom: "1px solid var(--rule)" }}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td
      className={`tabular px-3 py-1.5 text-xs${className ? ` ${className}` : ""}`}
      style={{ color: "var(--ink)", borderBottom: "1px solid var(--rule)" }}
    >
      {children}
    </td>
  );
}

export default function NeedsPortalCheckPage() {
  const [runs, setRuns] = useState<UnverifiedAddressRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rpa-unverified")
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="flex-1 flex flex-col gap-4 p-6 max-w-4xl mx-auto w-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>Needs Portal Check</h1>
        <p className="text-xs" style={{ color: "var(--label)" }}>
          The Client Portal&apos;s own location search found no match for these addresses, so the RPA typed them
          in from the booking form directly instead of picking a verified portal record. Worth a closer look
          when you check these orders in the portal — the data may still be correct, it just wasn&apos;t
          confirmed against the portal&apos;s own database.
        </p>
      </header>

      <div
        className="rounded-md overflow-auto"
        style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)" }}
      >
        <table className="w-full">
          <thead>
            <tr><Th>Run at</Th><Th>Job</Th><Th>Client</Th><Th>Side</Th><Th>Point name (extracted)</Th><Th>Address typed</Th><Th>Postcode</Th></tr>
          </thead>
          <tbody>
            {runs?.map((r, i) => (
              <tr key={`${r.job_number}-${r.side}-${i}`}>
                <Td>{fmtDateTime(r.run_at)}</Td>
                <Td>{r.job_number}</Td>
                <Td>{r.client_name}</Td>
                <Td className="capitalize">{r.side}</Td>
                <Td className="max-w-[220px] truncate">{r.point}</Td>
                <Td className="max-w-[220px] truncate">{r.address_typed}</Td>
                <Td>{r.postcode}</Td>
              </tr>
            ))}
            {runs && runs.length === 0 && (
              <tr><Td>Nothing outstanding — every recent RPA fill matched a real portal record.</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )}
            {!runs && !error && (
              <tr><Td>Loading…</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )}
            {error && (
              <tr><Td className="max-w-[600px]" >{error}</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
