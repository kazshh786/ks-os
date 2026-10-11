import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchWithAuth } from "../../api/client";

export const autopilotButton =
  "min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50";
async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const res = await fetchWithAuth(
    "/api/v1/" + path,
    body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      json?.error?.message ?? "Could not load Autopilot. Please try again.",
    );
  return json.data;
}
type Summary = {
  attention: { issues: number; approvals: number };
  controls: { outboundPaused: boolean; emergencyStopped: boolean };
  counts: { handled: number; tasks: number; queued: number };
  playbooks: { id: string; name: string; status: string; version: string }[];
  approvals: {
    reference: string;
    title: string;
    reason: string;
    requestedAt: string;
    expiresAt: string;
    quoteNumber?: string;
    customerName?: string;
    opportunityReference?: string;
  }[];
  issues: { reference: string; category: string; severity: string }[];
  activity: { at: string | null; label: string; playbook: string }[];
};
export function AutopilotPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setData(await request<Summary>("autopilot"));
  }, []);
  useEffect(() => {
    let live = true;
    request<Summary>("autopilot")
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function act(path: string, body: unknown, method?: string) {
    setBusy(true);
    setError("");
    try {
      await request(path, body, method);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your choice.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-indigo-700">
            Managed by KS OS
          </p>
          <h1 className="text-3xl font-bold text-slate-950">Autopilot</h1>
          <p className="mt-2 text-slate-600">
            Routine follow-up, handled. Decisions stay with you.
          </p>
        </div>
        <Link className={autopilotButton} to="/app/automations">
          Advanced settings
        </Link>
      </header>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">Loading your activity…</p>
      ) : (
        <>
          {data.controls.emergencyStopped && (
            <p role="status" className="rounded-xl bg-amber-50 p-4">
              Managed automation is stopped by your service team. Contact the
              team to resume.
            </p>
          )}
          <section aria-label="Today" className="grid gap-4 sm:grid-cols-3">
            <Stat
              value={data.counts.handled}
              label="Actions completed today"
              detail="Includes messages queued for delivery"
            />
            <Stat
              value={data.counts.tasks}
              label="Follow-up tasks created"
              detail="Ready for your team"
            />
            <Stat
              value={data.attention.approvals + data.attention.issues}
              label="Items needing attention"
              detail="Decisions and open issues below"
            />
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-xl font-semibold">Needs you</h2>
            {!data.approvals.length && !data.issues.length && (
              <p className="mt-3 text-slate-600">
                Nothing needs your attention right now.
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {data.approvals.map((a) => (
                <li key={a.reference} className="space-y-3 py-4">
                  <h3 className="font-semibold">{a.title}</h3>
                  {(a.quoteNumber || a.customerName) && (
                    <p className="text-sm font-medium">
                      {a.quoteNumber} · {a.customerName}
                    </p>
                  )}
                  <p className="text-sm text-slate-600">{a.reason}</p>
                  {a.opportunityReference && (
                    <Link
                      className={autopilotButton}
                      to={`/app/sales/${a.opportunityReference}`}
                    >
                      Review quote and customer
                    </Link>
                  )}
                  <p className="text-xs text-slate-500">
                    Requested {new Date(a.requestedAt).toLocaleString()} ·
                    Expires {new Date(a.expiresAt).toLocaleDateString()}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={autopilotButton}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          `autopilot/approvals/${a.reference}/decision`,
                          { decision: "APPROVED" },
                        )
                      }
                    >
                      Approve follow-up task
                    </button>
                    <button
                      className={autopilotButton}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          `autopilot/approvals/${a.reference}/decision`,
                          { decision: "REJECTED" },
                        )
                      }
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {data.issues.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4">
                <p>
                  {data.attention.issues} open{" "}
                  {data.issues.length === 1 ? "issue" : "issues"} need review.
                </p>
                <Link className={autopilotButton} to="/app/operations">
                  Review issues
                </Link>
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-xl font-semibold">
              KS OS is handling this for you
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              These playbooks create internal follow-ups and surface exceptions.
              They do not start marketing campaigns.
            </p>
            {!data.playbooks.length && (
              <p className="mt-4">
                Your profile’s managed playbooks will appear after the next
                worker cycle.
              </p>
            )}
            <ul className="mt-4 divide-y divide-slate-100">
              {data.playbooks.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <h3 className="font-medium">{p.name}</h3>
                    <p className="text-sm text-slate-500">
                      Managed by KS OS · v{p.version}
                    </p>
                  </div>
                  <button
                    className={autopilotButton}
                    role="switch"
                    aria-checked={p.status === "ACTIVE"}
                    aria-label={p.name}
                    disabled={busy || p.status === "ARCHIVED"}
                    onClick={() =>
                      void act(
                        `automations/${p.id}/${p.status === "ACTIVE" ? "pause" : "activate"}`,
                        {},
                      )
                    }
                  >
                    {p.status === "ACTIVE" ? "On" : "Off"}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t pt-4">
              <button
                className={autopilotButton}
                disabled={busy}
                onClick={() =>
                  void act(
                    "autopilot/controls",
                    { outboundPaused: !data.controls.outboundPaused },
                    "PUT",
                  )
                }
              >
                {data.controls.outboundPaused
                  ? "Resume Autopilot messages"
                  : "Pause Autopilot messages"}
              </button>
              <p className="mt-2 text-sm text-slate-500">
                Pauses automation rules’ messages, appointment reminders, form
                reminders and review requests. Your history is kept.
              </p>
            </div>
          </section>
          <details className="rounded-2xl border border-slate-200 bg-white p-5">
            <summary className="min-h-11 cursor-pointer font-semibold focus-visible:outline focus-visible:outline-indigo-600">
              View automation history
            </summary>
            <p className="text-sm text-slate-500">
              Latest 50 actions. Queued messages have not necessarily been sent.
            </p>
            <ol className="mt-3 divide-y divide-slate-100">
              {data.activity.map((a, i) => (
                <li key={i} className="py-3">
                  <p className="font-medium">{a.label}</p>
                  <p className="text-sm text-slate-500">
                    {a.playbook}
                    {a.at ? ` · ${new Date(a.at).toLocaleString()}` : ""}
                  </p>
                </li>
              ))}
            </ol>
            {!data.activity.length && (
              <p className="py-4 text-slate-600">
                Your completed activity will appear here.
              </p>
            )}
          </details>
        </>
      )}
    </main>
  );
}
function Stat({
  value,
  label,
  detail,
}: {
  value: number;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-3xl font-bold">{value}</p>
      <h2 className="mt-2 font-medium">{label}</h2>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}
