import { useContext } from "react";
import { canUseProfileModule } from "@ks-os/contracts";
import { AuthContext } from "../../auth/useAuth";
import { useBusinessProfile } from "../../auth/useBusinessProfile";
import { fetchWithAuth } from "../../api/client";
export async function invoiceApi<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetchWithAuth("/api/v1/invoices" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload?.error?.message ??
        payload?.message ??
        "The invoice request failed.",
    );
  return payload.data;
}
export function useInvoices() {
  const auth = useContext(AuthContext),
    profile = useBusinessProfile();
  return {
    scope: auth
      ? `${auth.tenantId}:${auth.membershipReference}:${auth.permissions.join(",")}`
      : "",
    enabled: !!auth && canUseProfileModule(profile, "invoices", auth),
    canCreate:
      !!auth &&
      (auth.role === "owner" || auth.permissions.includes("INVOICES_CREATE")),
    owner: auth?.role === "owner",
  };
}
export const money = (amount: number | string, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    Number(amount) / 100,
  );
export const date = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export const label = (value: string) =>
  value.toLowerCase().replaceAll("_", " ");
export function minor(value: string) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a positive amount with at most two decimal places.");
  const [whole, decimal = ""] = value.split(".");
  const amount = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
  if (amount > 2147483647n) throw new Error("Amount is too large.");
  return Number(amount);
}
export const decimal = (value: number) =>
  `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;
export const button =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50";
export const input =
  "mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600";
export const panel = "rounded-2xl border border-slate-200 bg-white p-5";
