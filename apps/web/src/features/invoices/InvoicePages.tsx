import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Invoice, InvoiceSourceSchema } from "@ks-os/contracts";
import type { z } from "zod";
import {
  invoiceApi,
  useInvoices,
  money,
  date,
  label,
  button,
  panel,
} from "./invoice-client";
import { InvoiceEditor } from "./InvoiceEditor";
import { InvoicePayments } from "./InvoicePayments";
import { InvoiceSettings } from "./InvoiceSettings";
type Card = Pick<
  Invoice,
  | "reference"
  | "number"
  | "title"
  | "customer"
  | "currency"
  | "status"
  | "total"
  | "paid"
  | "due"
  | "dueAt"
>;
type Page = {
  items: Card[];
  nextCursor: string | null;
  canCreate: boolean;
  summary: Array<{
    currency: string;
    invoiced: string;
    paid: string;
    owed: string;
    overdue: string;
    dueThisWeek: string;
    customers: number;
  }>;
};
function InvoiceCards({ items }: { items: Card[] }) {
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.reference} className={panel}>
          <Link
            className="block min-h-11 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"
            to={"/app/invoices/" + i.reference}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <strong>{i.customer.name}</strong>
              <strong>
                {money(i.status === "DRAFT" ? i.total : i.due, i.currency)}{" "}
                {i.status === "DRAFT" ? "draft total" : "remaining"}
              </strong>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Due {date(i.dueAt)} · {label(i.status)}
            </p>
            <p className="mt-1 break-words text-sm text-slate-500">
              {i.number} · {i.title}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function InvoiceWorkspace() {
  const { enabled, owner, scope } = useInvoices();
  const [filter, setFilter] = useState("OWED"),
    [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [defaults, setDefaults] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setPage(null);
    setError("");
    invoiceApi<Page>("/?filter=" + filter)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [enabled, filter, scope]);
  async function more() {
    if (!page?.nextCursor) return;
    setBusy(true);
    try {
      const next = await invoiceApi<Page>(
        "/?filter=" + filter + "&cursor=" + page.nextCursor,
      );
      setPage({ ...next, items: [...page.items, ...next.items] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!enabled)
    return (
      <p className="p-6">
        Invoices are not enabled for your access or business profile.
      </p>
    );
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Money owed</h1>
          <p className="mt-1 text-slate-600">
            Who owes you money, and when it is due.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {page?.canCreate && (
            <Link className={button} to="/app/invoices/new">
              Create invoice
            </Link>
          )}
          {owner && (
            <button className={button} onClick={() => setDefaults(!defaults)}>
              Invoice defaults
            </button>
          )}
        </div>
      </header>
      {defaults && <InvoiceSettings key={scope} />}
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
      {!!page?.summary.length && (
        <section aria-label="Invoice balances" className="space-y-3">
          {page.summary.map((s) => (
            <div key={s.currency} className={panel}>
              <p className="text-sm text-slate-500">
                {s.currency} · Issued invoices only
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p>Outstanding · {s.customers} customers</p>
                  <p className="text-2xl font-bold">
                    {money(s.owed, s.currency)}
                  </p>
                </div>
                <div>
                  <p>Overdue</p>
                  <p className="text-xl font-semibold">
                    {money(s.overdue, s.currency)}
                  </p>
                </div>
                <div>
                  <p>Due in the next 7 days</p>
                  <p className="text-xl font-semibold">
                    {money(s.dueThisWeek, s.currency)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
      <nav aria-label="Invoice filters" className="flex flex-wrap gap-2">
        {["OWED", "OVERDUE", "DRAFT", "PAID", "ALL"].map((f) => (
          <button
            className={button}
            aria-pressed={filter === f}
            key={f}
            onClick={() => setFilter(f)}
          >
            {f === "OWED" ? "Money owed" : label(f)}
          </button>
        ))}
      </nav>
      {!page && !error ? (
        <p role="status">Loading invoices…</p>
      ) : page && !page.items.length ? (
        <section className={panel}>
          <h2 className="font-semibold">
            {filter === "ALL" ? "No invoices yet" : "No invoices in this view"}
          </h2>
          <p className="mt-2 text-slate-600">
            Create an invoice when you need to collect payment from a customer.
          </p>
        </section>
      ) : (
        page && <InvoiceCards items={page.items} />
      )}
      {page?.nextCursor && (
        <button disabled={busy} className={button} onClick={() => void more()}>
          Show more invoices
        </button>
      )}
    </main>
  );
}
export function SourceInvoices({
  kind,
  reference,
  quotes = [],
}: {
  kind: z.infer<typeof InvoiceSourceSchema>["kind"];
  reference: string;
  quotes?: Array<{ reference: string; status: string; quoteNumber: string }>;
}) {
  const { enabled, canCreate, scope } = useInvoices();
  const [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setPage(null);
    invoiceApi<Page>(
      `/?filter=ALL&source=${kind}&sourceReference=${reference}&limit=5`,
    )
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [enabled, kind, reference, scope]);
  if (!enabled) return null;
  return (
    <section className={panel}>
      <h2 className="font-semibold">Invoices</h2>
      {error && <p role="alert">{error}</p>}
      {page && !page.items.length && (
        <p className="mt-2 text-slate-600">
          No invoices for this {kind === "SALE" ? "sale" : kind.toLowerCase()}{" "}
          yet.
        </p>
      )}
      {page && <InvoiceCards items={page.items} />}
      {page?.nextCursor && (
        <Link className={button} to="/app/invoices">
          View all invoices
        </Link>
      )}
      {canCreate && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            className={button}
            to={`/app/invoices/new?source=${kind}&reference=${reference}`}
          >
            Create invoice
          </Link>
          {quotes
            .filter((q) => q.status === "ACCEPTED")
            .map((q) => (
              <Link
                key={q.reference}
                className={button}
                to={`/app/invoices/new?source=QUOTE&reference=${q.reference}`}
              >
                Invoice {q.quoteNumber}
              </Link>
            ))}
        </div>
      )}
    </section>
  );
}
export function InvoiceCreatePage() {
  const [query] = useSearchParams(),
    navigate = useNavigate();
  const { enabled } = useInvoices();
  if (!enabled)
    return (
      <p className="p-6">
        Invoices are not enabled for your access or business profile.
      </p>
    );
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
      <Link className={button} to="/app/invoices">
        Back to invoices
      </Link>
      <h1 className="text-2xl font-bold">Create invoice</h1>
      <InvoiceEditor
        source={query.get("source")}
        sourceReference={query.get("reference")}
        clientReference={query.get("clientReference")}
        onSaved={(i) => navigate("/app/invoices/" + i.reference)}
      />
    </main>
  );
}
export function InvoiceDetailPage() {
  const { reference = "" } = useParams(),
    { enabled, scope } = useInvoices();
  const [invoice, setInvoice] = useState<Invoice | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    setInvoice(null);
    setError("");
    setEditing(false);
    if (!enabled) return;
    let active = true;
    invoiceApi<Invoice>("/" + reference)
      .then((i) => {
        if (active) setInvoice(i);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [reference, enabled, scope]);
  async function transition(state: string) {
    setBusy(true);
    setError("");
    try {
      setInvoice(await invoiceApi<Invoice>(`/${reference}/${state}`, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!enabled)
    return (
      <p className="p-6">
        Invoices are not enabled for your access or business profile.
      </p>
    );
  const i = invoice;
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
      <Link className={button} to="/app/invoices">
        Back to money owed
      </Link>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
      {!i && !error && <p role="status">Loading invoice…</p>}
      {i && (
        <>
          <header>
            <p className="text-sm text-slate-500">
              Invoice {i.number} · {label(i.status)}
            </p>
            <h1 className="mt-1 break-words text-2xl font-bold">{i.title}</h1>
            <Link
              className="mt-2 inline-flex min-h-11 items-center font-semibold text-indigo-700"
              to={"/app/clients/" + i.customer.reference}
            >
              {i.customer.name}
            </Link>
          </header>
          <section className={panel}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Total", money(i.total, i.currency)],
                ["Paid", money(i.paid, i.currency)],
                [
                  "Remaining",
                  i.status === "DRAFT"
                    ? "Not issued"
                    : money(i.due, i.currency),
                ],
                ["Due", date(i.dueAt)],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-sm text-slate-500">{k}</p>
                  <p className="mt-1 text-xl font-semibold">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {i.status === "DRAFT" && i.actions.manage && (
                <>
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() => setEditing(!editing)}
                  >
                    Edit draft
                  </button>
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() => void transition("issue")}
                  >
                    Issue invoice
                  </button>
                </>
              )}
              {i.actions.void && (
                <button
                  disabled={busy}
                  className={button}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Void this invoice? This cannot be undone.",
                      )
                    )
                      void transition("void");
                  }}
                >
                  Void invoice
                </button>
              )}
            </div>
          </section>
          {editing && (
            <InvoiceEditor
              invoice={i}
              onSaved={(next) => {
                setInvoice(next);
                setEditing(false);
              }}
            />
          )}
          <section className={panel}>
            <h2 className="font-semibold">Items</h2>
            <ul className="mt-3 divide-y">
              {i.items.map((line, n) => (
                <li key={n} className="flex justify-between gap-3 py-3">
                  <div>
                    <p className="break-words">{line.description}</p>
                    <p className="text-sm text-slate-500">
                      {line.quantity} × {money(line.unitAmount, i.currency)} ·
                      Tax {line.taxRateBasisPoints / 100}%
                    </p>
                  </div>
                  <strong className="whitespace-nowrap">
                    {money(line.total, i.currency)}
                  </strong>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-right text-sm">
              Subtotal {money(i.subtotal, i.currency)} · Tax{" "}
              {money(i.tax, i.currency)}
            </p>
            {i.memo && <p className="mt-4 whitespace-pre-wrap">{i.memo}</p>}
            {i.footer && (
              <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">
                {i.footer}
              </p>
            )}
          </section>
          <InvoicePayments invoice={i} onChanged={setInvoice} />
          {!!i.sources.length && (
            <section className={panel}>
              <h2 className="font-semibold">Related records</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {i.sources.map((s) => (
                  <Link
                    className={button}
                    key={s.kind + s.reference}
                    to={
                      s.kind === "WORK"
                        ? "/app/work/" + s.reference
                        : s.kind === "SALE"
                          ? "/app/sales/" + s.reference
                          : s.kind === "BOOKING"
                            ? "/app/bookings?reference=" + s.reference
                            : "/app/sales"
                    }
                  >
                    {label(s.kind)}
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className={panel}>
            <h2 className="font-semibold">Activity</h2>
            <p className="mt-1 text-sm text-slate-500">
              Latest 100 recorded events.
            </p>
            <ul className="mt-3 divide-y">
              {i.activity.map((a) => (
                <li key={a.reference} className="py-3">
                  <p>
                    {label(a.type)}
                    {a.amount !== null
                      ? " · " + money(a.amount, i.currency)
                      : ""}
                  </p>
                  <time className="text-sm text-slate-500" dateTime={a.at}>
                    {new Date(a.at).toLocaleString("en-GB")}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
