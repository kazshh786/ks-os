import { useEffect, useState } from "react";
import type { Invoice } from "@ks-os/contracts";
import {
  invoiceApi,
  minor,
  decimal,
  input,
  button,
  panel,
} from "./invoice-client";
type Line = {
  description: string;
  quantity: string;
  amount: string;
  tax: string;
};
type Context = {
  customers: Array<{ reference: string; name: string }>;
  title: string;
  currency: string;
  items: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    taxRateBasisPoints: number;
  }>;
  defaults: { termsDays: number; footer: string };
};
const fromItem = (i: Context["items"][number]): Line => ({
  description: i.description,
  quantity: String(i.quantity),
  amount: decimal(i.unitAmount),
  tax: decimal(i.taxRateBasisPoints),
});
export function InvoiceEditor({
  source,
  sourceReference,
  clientReference,
  invoice,
  onSaved,
}: {
  source?: string | null;
  sourceReference?: string | null;
  clientReference?: string | null;
  invoice?: Invoice;
  onSaved: (i: Invoice) => void;
}) {
  const [search, setSearch] = useState(""),
    [searchBusy, setSearchBusy] = useState(false);
  const [context, setContext] = useState<Context | null>(null),
    [title, setTitle] = useState(invoice?.title ?? ""),
    [customer, setCustomer] = useState(
      invoice?.customer.reference ?? clientReference ?? "",
    ),
    [currency, setCurrency] = useState(invoice?.currency ?? "GBP"),
    [due, setDue] = useState(invoice?.dueAt.slice(0, 10) ?? ""),
    [memo, setMemo] = useState(invoice?.memo ?? ""),
    [lines, setLines] = useState<Line[]>(
      invoice?.items.map(fromItem) ?? [
        { description: "", quantity: "1", amount: "", tax: "0" },
      ],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (invoice) return;
    let active = true;
    const params = new URLSearchParams();
    if (source && sourceReference) {
      params.set("kind", source);
      params.set("reference", sourceReference);
    }
    if (clientReference) params.set("clientReference", clientReference);
    invoiceApi<Context>("/context?" + params)
      .then((c) => {
        if (!active) return;
        setContext(c);
        setTitle(c.title);
        setCurrency(c.currency);
        setCustomer(
          clientReference ?? (source ? (c.customers[0]?.reference ?? "") : ""),
        );
        setDue(
          new Date(Date.now() + c.defaults.termsDays * 86400000)
            .toISOString()
            .slice(0, 10),
        );
        if (c.items.length) setLines(c.items.map(fromItem));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [source, sourceReference, clientReference, invoice]);
  async function findCustomers() {
    setSearchBusy(true);
    setError("");
    try {
      const found = await invoiceApi<Context>(
        "/context?search=" + encodeURIComponent(search),
      );
      setContext((previous) =>
        previous ? { ...previous, customers: found.customers } : found,
      );
      setCustomer("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearchBusy(false);
    }
  }
  function change(n: number, key: keyof Line, value: string) {
    setLines((previous) =>
      previous.map((line, i) => (i === n ? { ...line, [key]: value } : line)),
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        title,
        dueAt: new Date(due + "T23:59:59.000Z").toISOString(),
        memo,
        items: lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitAmount: minor(l.amount),
          taxRateBasisPoints: minor(l.tax),
        })),
      };
      const result = invoice
        ? await invoiceApi<Invoice>("/" + invoice.reference, body, "PATCH")
        : source === "QUOTE" && sourceReference
          ? await invoiceApi<Invoice>("/from-quote/" + sourceReference, {
              dueAt: body.dueAt,
            })
          : await invoiceApi<Invoice>("/", {
              ...body,
              clientReference: customer,
              currency,
              idempotencyKey: key,
              ...(source && sourceReference
                ? { source: { kind: source, reference: sourceReference } }
                : {}),
            });
      onSaved(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const quote = source === "QUOTE";
  return (
    <form onSubmit={submit} className={panel + " space-y-4"}>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
      {!invoice && !context && !error && (
        <p role="status">Loading invoice details…</p>
      )}
      {!invoice && !source && !clientReference && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-sm">
            Find customer
            <input
              maxLength={100}
              className={input}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={button}
            disabled={searchBusy}
            onClick={() => void findCustomers()}
          >
            Search customers
          </button>
        </div>
      )}
      {!invoice && (
        <label className="block text-sm font-medium">
          Customer
          <select
            required
            disabled={!!source}
            className={input}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            <option value="">Choose customer</option>
            {context?.customers.map((c) => (
              <option key={c.reference} value={c.reference}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium">
        For
        <input
          required
          maxLength={255}
          disabled={quote}
          className={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Due date
          <input
            required
            type="date"
            className={input}
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium">
          Currency
          <input
            required
            pattern="[A-Z]{3}"
            maxLength={3}
            disabled={!!invoice || quote}
            className={input}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
      </div>
      <fieldset disabled={quote}>
        <legend className="font-semibold">Items</legend>
        <div className="mt-3 space-y-3">
          {lines.map((line, n) => (
            <div
              key={n}
              className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-6"
            >
              <label className="text-sm sm:col-span-3">
                Description
                <input
                  required
                  maxLength={1000}
                  className={input}
                  value={line.description}
                  onChange={(e) => change(n, "description", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Quantity
                <input
                  required
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  className={input}
                  value={line.quantity}
                  onChange={(e) => change(n, "quantity", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Unit price
                <input
                  required
                  inputMode="decimal"
                  className={input}
                  value={line.amount}
                  onChange={(e) => change(n, "amount", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Tax %
                <input
                  required
                  inputMode="decimal"
                  className={input}
                  value={line.tax}
                  onChange={(e) => change(n, "tax", e.target.value)}
                />
              </label>
              {lines.length > 1 && (
                <button
                  type="button"
                  className={button + " sm:col-span-2"}
                  onClick={() =>
                    setLines((previous) => previous.filter((_, i) => i !== n))
                  }
                >
                  Remove item {n + 1}
                </button>
              )}
            </div>
          ))}
        </div>
        {lines.length < 100 && (
          <button
            type="button"
            className={button + " mt-3"}
            onClick={() =>
              setLines((previous) => [
                ...previous,
                { description: "", quantity: "1", amount: "", tax: "0" },
              ])
            }
          >
            Add item
          </button>
        )}
      </fieldset>
      {quote ? (
        <p className="text-sm text-slate-600">
          The accepted quote’s currency and items are copied exactly. Repeating
          this action opens the same invoice.
        </p>
      ) : (
        <label className="block text-sm">
          Customer memo
          <textarea
            maxLength={2000}
            className={input}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
      )}
      <p className="text-sm text-slate-500">
        The total is calculated when saved. Drafts can be reviewed before
        issuing.
      </p>
      <button disabled={busy || (!invoice && !context)} className={button}>
        {busy ? "Saving…" : invoice ? "Save draft" : "Create draft"}
      </button>
    </form>
  );
}
