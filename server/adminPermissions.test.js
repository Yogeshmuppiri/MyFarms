import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  ADMIN_PERMISSION_KEYS,
  isPermissionAllowedForRole,
  normalizeAdminPermissions
} = require("./adminPermissions");

describe("admin permission configuration", () => {
  it("keeps permission keys unique", () => {
    expect(new Set(ADMIN_PERMISSION_KEYS).size).toBe(ADMIN_PERMISSION_KEYS.length);
  });

  it("normalizes unknown and duplicate permissions", () => {
    expect(normalizeAdminPermissions(["orders", "orders", "missing", "inventory_alerts"])).toEqual([
      "orders",
      "inventory_alerts"
    ]);
  });

  it("enforces role-limited delivery permissions", () => {
    expect(isPermissionAllowedForRole("delivery_agent", "Delivery Associate")).toBe(true);
    expect(isPermissionAllowedForRole("delivery_agent", "Operations Manager")).toBe(false);

    expect(isPermissionAllowedForRole("delivery_supervisor", "Inventory Associate")).toBe(true);
    expect(isPermissionAllowedForRole("delivery_supervisor", "Operations Manager")).toBe(true);
    expect(isPermissionAllowedForRole("delivery_supervisor", "Admin Assistant")).toBe(false);

    expect(isPermissionAllowedForRole("delivery_assign", "Admin Assistant")).toBe(true);
    expect(isPermissionAllowedForRole("delivery_assign", "Delivery Associate")).toBe(false);
  });

  it("allows unrestricted tools for every role", () => {
    expect(isPermissionAllowedForRole("inventory_alerts", "Support Associate")).toBe(true);
    expect(isPermissionAllowedForRole("orders", "Delivery Associate")).toBe(true);
  });
});
