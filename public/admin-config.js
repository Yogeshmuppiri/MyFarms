(function () {
  const permissions = [
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

  const roleLimitedPermissions = {
    delivery_assign: ["Inventory Associate", "Operations Manager", "Admin Assistant"],
    delivery_supervisor: ["Inventory Associate", "Operations Manager"],
    delivery_agent: ["Delivery Associate"]
  };

  function isPermissionAllowedForRole(permission, role) {
    const allowedRoles = roleLimitedPermissions[permission];
    if (!allowedRoles) return true;
    return allowedRoles.includes(String(role || "").trim());
  }

  window.MyFarmsAdminConfig = {
    permissions,
    roleLimitedPermissions,
    isPermissionAllowedForRole
  };
})();
