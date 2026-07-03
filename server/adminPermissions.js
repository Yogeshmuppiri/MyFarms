const ADMIN_PERMISSIONS = [
  { key: "alerts", label: "New Order Alerts" },
  { key: "dashboard", label: "Dashboard" },
  { key: "promos", label: "Promo Management" },
  { key: "products", label: "Product Management" },
  { key: "stock", label: "Stock Control" },
  { key: "inventory_alerts", label: "Inventory Alerts" },
  { key: "orders", label: "Orders" },
  { key: "delivery_assign", label: "Delivery Assignment" },
  { key: "delivery_supervisor", label: "Delivery Supervisor Dashboard" },
  { key: "delivery_agent", label: "Delivery Agent Portal" },
  { key: "complaints", label: "Customer Complaints" },
  { key: "administration", label: "Administration" }
];

const ADMIN_PERMISSION_KEYS = ADMIN_PERMISSIONS.map((permission) => permission.key);

const ROLE_LIMITED_PERMISSIONS = {
  delivery_assign: ["Inventory Associate", "Operations Manager", "Admin Assistant"],
  delivery_supervisor: ["Inventory Associate", "Operations Manager"],
  delivery_agent: ["Delivery Associate"]
};

function isPermissionAllowedForRole(permission, role) {
  const allowedRoles = ROLE_LIMITED_PERMISSIONS[permission];
  if (!allowedRoles) return true;
  return allowedRoles.includes(String(role || "").trim());
}

function normalizeAdminPermissions(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.filter((permission) => ADMIN_PERMISSION_KEYS.includes(permission)))];
}

module.exports = {
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_KEYS,
  ROLE_LIMITED_PERMISSIONS,
  isPermissionAllowedForRole,
  normalizeAdminPermissions
};
