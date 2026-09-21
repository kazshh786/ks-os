import { useEffect, useState } from "react";
import type { Invoice } from "@ks-os/contracts";
import {
  invoiceApi,
  money,
  date,
  label,
  minor,
  decimal,
  button,
  input,
  panel,
} from "./invoice-client";
export function InvoicePayments({
  invoice: i,
  onChanged,
}: {
  invoice: Invoice;
  onChanged: (i: Invoice) => void;
}) {
  const [mode, setMode] = useState<"record" | "allocate" | "refund" | null>(
      null,
    ),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState("BANK_TRANSFER"),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState(""),
    [payment, setPayment] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [available, setAvailable] = useState<
      Array<{
        reference: string;
        amount: number;
        net: number;
        method: string;
        at: string;
      }>
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (mode !== "allocate") return;
    let active = true;
    invoiceApi<typeof available>(`/${i.reference}/payments/available`)
      .then((v) => {
        if (active) setAvailable(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [mode, i.reference]);
  function open(next: typeof mode, p?: Invoice["payments"][number]) {
    setMode(next);
    setAmount(decimal(p?.net ?? i.due));
    setPayment(p?.reference ?? "");
    setReference("");
    setReason("");
    setError("");
    setKey(crypto.randomUUID());
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body =
        mode === "record"
          ? { amount: minor(amount), method, reference, idempotencyKey: key }
          : mode === "refund"
            ? {
                amount: minor(amount),
                paymentReference: payment,
                reason,
                idempotencyKey: key,
              }
            : { paymentReference: payment };
      const endpoint =
        mode === "record"
          ? "payments"
          : mode === "refund"
            ? "refunds"
            : "allocations";
      const next = await invoiceApi<Invoice>(
        `/${i.reference}/${endpoint}`,
        body,
      );
      onChanged(next);
      setMode(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={panel}>
      <h2 className="font-semibold">Payments</h2>
      <p className="mt-1 text-sm text-slate-600">
        Actual payments allocated to this invoice. Confirmed refunds restore the
        amount owed.
      </p>
      {i.actions.recordPayment && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={button} onClick={() => open("record")}>
            Record payment received
          </button>
          <button className={button} onClick={() => open("allocate")}>
            Use an existing payment
          </button>
        </div>
      )}
      {mode && (
        <form
          onSubmit={submit}
          className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4"
        >
          <h3 className="font-semibold">
            {mode === "refund"
              ? "Record refund already paid"
              : mode === "allocate"
                ? "Allocate an existing payment"
                : "Record money already received"}
          </h3>
          <p className="text-sm text-slate-600">
            {mode === "refund"
              ? "Only confirm after returning the money through the original cash, bank, or external card method."
              : mode === "allocate"
                ? "Only confirmed payments for this customer and currency are shown. Unverified historic deposits are excluded."
                : "This records an actual payment. It does not charge a card or send a payment request."}
          </p>
          {error && (
            <p role="alert" className="text-rose-700">
              {error}
            </p>
          )}
          {mode === "allocate" ? (
            <label className="block text-sm">
              Payment
              <select
                required
                className={input}
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                <option value="">Choose payment</option>
                {available.map((p) => (
                  <option key={p.reference} value={p.reference}>
                    {money(p.net, i.currency)} · {date(p.at)} ·{" "}
                    {label(p.method)}
                  </option>
                ))}
              </select>
              {!available.length && <span>No eligible payments found.</span>}
            </label>
          ) : (
            <label className="block text-sm">
              Amount ({i.currency})
              <input
                required
                inputMode="decimal"
                className={input}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}
          {mode === "record" && (
            <>
              <label className="block text-sm">
                Payment method
                <select
                  className={input}
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="CASH">Cash</option>
                  <option value="EXTERNAL_CARD">External card terminal</option>
                </select>
              </label>
              <label className="block text-sm">
                Reference (optional)
                <input
                  maxLength={120}
                  className={input}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
            </>
          )}
          {mode === "refund" && (
            <label className="block text-sm">
              Reason
              <input
                required
                minLength={3}
                maxLength={500}
                className={input}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" required />
            {mode === "refund"
              ? "I confirm this money has been returned."
              : mode === "record"
                ? "I confirm this money has been received."
                : "Apply this payment to this invoice."}
          </label>
          <div className="flex gap-2">
            <button disabled={busy} className={button}>
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={button}
              onClick={() => setMode(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <ul className="mt-4 divide-y">
        {i.payments.map((p) => (
          <li
            key={p.reference}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <div>
              <p className="font-semibold">
                {money(p.net, i.currency)} net received
              </p>
              <p className="text-sm text-slate-500">
                {label(p.method)} · {date(p.at)}
                {p.net !== p.amount
                  ? " · Originally " + money(p.amount, i.currency)
                  : ""}
              </p>
            </div>
            {p.canReverse && (
              <button className={button} onClick={() => open("refund", p)}>
                Record refund
              </button>
            )}
          </li>
        ))}
      </ul>
      {!i.payments.length && (
        <p className="mt-3 text-sm text-slate-500">
          No payments allocated yet.
        </p>
      )}
    </section>
  );
}
