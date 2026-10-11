import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { agencyFetch, useAgencyAuth } from "../agency/AgencyAuth";
import { autopilotButton } from "./AutopilotPage";
type Business = {
  reference: string;
  name: string;
  state: string;
  reason: string;
  stopped: boolean;
  issues: number;
  failures: number;
  approvals: number;
};
type Centre = {
  businesses: Business[];
  nextOffset: number | null;
  queue: {
    reference: string;
    business: string;
    businessReference: string;
    category: string;
    severity: string;
    reason: string;
    at: string;
    next: string;
  }[];
};
export function AgencyAutopilotPage() {
  const { session } = useAgencyAuth();
  const canStop = session?.capabilities.includes("fulfilment.manage");
  const [data, setData] = useState<Centre | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    agencyFetch(`/autopilot?offset=${offset}`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [offset]);
  async function stop(b: Business) {
    setBusy(true);
    setError("");
    try {
      await agencyFetch(`/autopilot/${b.reference}/emergency-stop`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopped: !b.stopped }),
      });
      setData(await agencyFetch(`/autopilot?offset=${offset}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update automation.");
    } finally {
      setBusy(false);
    }
  }
  const rank: Record<string, number> = {
    DEGRADED: 0,
    ACTION_REQUIRED: 1,
    ATTENTION: 2,
    HEALTHY: 3,
  };
  const ordered = data
    ? [...data.businesses].sort(
        (a, b) => (rank[a.state] ?? 4) - (rank[b.state] ?? 4),
      )
    : [];
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl font-bold">Managed Service Autopilot</h1>
        <p className="mt-2 text-slate-600">
          Business exceptions and decisions, in one place.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">Loading managed businesses…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                "Healthy on this page",
                data.businesses.filter((b) => b.state === "HEALTHY").length,
              ],
              [
                "Needs review on this page",
                data.businesses.filter((b) => b.state !== "HEALTHY").length,
              ],
              [
                "Approvals waiting on this page",
                data.businesses.reduce((n, b) => n + b.approvals, 0),
              ],
            ].map(([label, count]) => (
              <div key={label} className="rounded-2xl border bg-white p-5">
                <p className="text-3xl font-bold">{count}</p>
                <p className="mt-2 text-sm">{label}</p>
              </div>
            ))}
          </div>
          <section className="rounded-2xl border bg-white p-5">
            <h2 className="text-xl font-semibold">Prioritised review queue</h2>
            <p className="mt-1 text-sm text-slate-500">
              Up to 100 items for the businesses on this page. Owner decisions
              stay with the owner.
            </p>
            <ul className="divide-y">
              {data.queue.map((q) => (
                <li
                  key={q.reference}
                  className="flex flex-wrap justify-between gap-3 py-4"
                >
                  <div>
                    <h3 className="font-semibold">
                      {q.business} · {q.reason}
                    </h3>
                    <p className="text-sm">
                      {q.category.toLowerCase()} · {q.severity.toLowerCase()} ·
                      Since {new Date(q.at).toLocaleString()}
                    </p>
                    <p className="text-sm text-slate-600">{q.next}</p>
                  </div>
                  <Link
                    className={autopilotButton}
                    to={`/agency/tenants/${q.businessReference}/health`}
                  >
                    Review source
                  </Link>
                </li>
              ))}
            </ul>
            {!data.queue.length && (
              <p className="mt-3">No exceptions in this group.</p>
            )}
          </section>
          <ul className="space-y-3">
            {ordered.map((b) => (
              <li key={b.reference} className="rounded-2xl border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{b.name}</h2>
                    <p className="mt-1 font-medium">
                      {b.state.replaceAll("_", " ").toLowerCase()}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{b.reason}</p>
                    <p className="mt-2 text-sm">
                      {b.issues} open issues · {b.failures} failed actions ·{" "}
                      {b.approvals} decisions waiting
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className={autopilotButton}
                      to={`/agency/tenants/${b.reference}/health`}
                    >
                      Review business
                    </Link>
                    {canStop && (
                      <button
                        className={autopilotButton}
                        disabled={busy}
                        onClick={() => void stop(b)}
                      >
                        {b.stopped
                          ? "Resume managed automation"
                          : "Emergency stop"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {!data.businesses.length && (
            <p>No active managed businesses on this page.</p>
          )}
          <nav aria-label="Business pages" className="flex gap-3">
            <button
              className={autopilotButton}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </button>
            <button
              className={autopilotButton}
              disabled={data.nextOffset === null}
              onClick={() => setOffset(data.nextOffset ?? offset)}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
