import { useInvoices } from "../invoices/invoice-client";
const permissions = [
  ["INVOICES_VIEW", "View invoices and customer balances"],
  ["INVOICES_CREATE", "Create invoice drafts"],
  ["INVOICES_MANAGE", "Edit drafts, issue and void invoices"],
  [
    "INVOICES_RECORD_PAYMENT",
    "Record payments, allocate deposits and record refunds",
  ],
] as const;
export function InvoiceAccessControls({
  overrides,
  onChange,
}: {
  overrides: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}) {
  const { enabled } = useInvoices();
  if (!enabled) return null;
  function change(capability: string, checked: boolean) {
    const next = { ...overrides, [capability]: checked };
    if (checked) next.INVOICES_VIEW = true;
    else if (capability === "INVOICES_VIEW")
      for (const [key] of permissions) next[key] = false;
    onChange(next);
  }
  return (
    <fieldset className="rounded-2xl border bg-white p-5">
      <legend className="font-bold">Invoice access</legend>
      <p className="mb-3 text-sm text-slate-600">
        Invoice access covers customer money across this business. Sales, Work
        and booking access remain separately controlled.
      </p>
      {permissions.map(([key, label]) => (
        <label key={key} className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={overrides[key] === true}
            onChange={(e) => change(key, e.target.checked)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
