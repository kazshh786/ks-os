import { useEffect, useState } from "react";
import { invoiceApi, input, button, panel } from "./invoice-client";
type Settings = { termsDays: number; prefix: string; footer: string };
export function InvoiceSettings() {
  const [value, setValue] = useState<Settings | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    invoiceApi<Settings>("/settings")
      .then((v) => {
        if (active) setValue(v);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setValue(await invoiceApi("/settings", value, "PUT"));
      setMessage("Defaults saved for new invoices.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className={panel + " space-y-3"}>
      <h2 className="font-semibold">Invoice defaults</h2>
      {message && <p role="status">{message}</p>}
      {value && (
        <>
          <label className="block text-sm">
            Payment terms
            <select
              className={input}
              value={value.termsDays}
              onChange={(e) =>
                setValue({ ...value, termsDays: Number(e.target.value) })
              }
            >
              {[0, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d ? `${d} days` : "Due now"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Invoice prefix
            <input
              required
              pattern="[A-Z][A-Z0-9-]{0,9}"
              className={input}
              value={value.prefix}
              onChange={(e) =>
                setValue({ ...value, prefix: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label className="block text-sm">
            Footer / payment instructions
            <textarea
              maxLength={2000}
              className={input}
              value={value.footer}
              onChange={(e) => setValue({ ...value, footer: e.target.value })}
            />
          </label>
          <button className={button} disabled={busy}>
            Save defaults
          </button>
        </>
      )}
    </form>
  );
}
