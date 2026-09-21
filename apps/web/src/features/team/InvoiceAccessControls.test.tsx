import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { resolveBusinessProfile } from "@ks-os/contracts";
import { AuthContext } from "../../auth/useAuth";
import { InvoiceAccessControls } from "./InvoiceAccessControls";
vi.mock("../../api/client", () => ({ fetchWithAuth: vi.fn() }));
function show(type: string, onChange = vi.fn(), overrides = {}) {
  render(
    <AuthContext.Provider
      value={
        {
          role: "owner",
          permissions: [],
          tenantId: "test",
          businessProfile: resolveBusinessProfile(type),
        } as any
      }
    >
      <InvoiceAccessControls overrides={overrides} onChange={onChange} />
    </AuthContext.Provider>,
  );
  return onChange;
}
describe("explicit invoice access", () => {
  it("does not add invoice controls to salon defaults", () => {
    show("SALON_BARBER");
    expect(screen.queryByText("Invoice access")).not.toBeInTheDocument();
  });
  it("granting payment access also grants the required view permission", () => {
    const changed = show("AGENCY");
    fireEvent.click(
      screen.getByLabelText(
        "Record payments, allocate deposits and record refunds",
      ),
    );
    expect(changed).toHaveBeenCalledWith({
      INVOICES_VIEW: true,
      INVOICES_RECORD_PAYMENT: true,
    });
  });
  it("revoking view clears invoice actions and preserves unrelated overrides", () => {
    const changed = show("AGENCY", vi.fn(), {
      INVOICES_VIEW: true,
      INVOICES_MANAGE: true,
      SALES_CREATE: true,
    });
    fireEvent.click(
      screen.getByLabelText("View invoices and customer balances"),
    );
    expect(changed).toHaveBeenCalledWith({
      INVOICES_VIEW: false,
      INVOICES_CREATE: false,
      INVOICES_MANAGE: false,
      INVOICES_RECORD_PAYMENT: false,
      SALES_CREATE: true,
    });
  });
});
