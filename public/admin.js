const els = {
  loginCard: document.getElementById("loginCard"),
  panelCard: document.getElementById("panelCard"),
  adminActions: document.getElementById("adminActions"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminEmail: document.getElementById("adminEmail"),
  adminPassword: document.getElementById("adminPassword"),
  dashboardFilterForm: document.getElementById("dashboardFilterForm"),
  dashboardDateFrom: document.getElementById("dashboardDateFrom"),
  dashboardDateTo: document.getElementById("dashboardDateTo"),
  dashboardStatus: document.getElementById("dashboardStatus"),
  dashboardCategory: document.getElementById("dashboardCategory"),
  kpiWrap: document.getElementById("kpiWrap"),
  topProducts: document.getElementById("topProducts"),
  lowStockList: document.getElementById("lowStockList"),
  trendChart: document.getElementById("trendChart"),
  orderFilterForm: document.getElementById("orderFilterForm"),
  orderDateFrom: document.getElementById("orderDateFrom"),
  orderDateTo: document.getElementById("orderDateTo"),
  orderStatus: document.getElementById("orderStatus"),
  orderCategory: document.getElementById("orderCategory"),
  newOrderAlerts: document.getElementById("newOrderAlerts"),
  complaintFilterForm: document.getElementById("complaintFilterForm"),
  complaintStatus: document.getElementById("complaintStatus"),
  complaintsWrap: document.getElementById("complaintsWrap"),
  promoForm: document.getElementById("promoForm"),
  promoCode: document.getElementById("promoCode"),
  promoDiscount: document.getElementById("promoDiscount"),
  promoMinOrder: document.getElementById("promoMinOrder"),
  promoMaxUses: document.getElementById("promoMaxUses"),
  promoExpiry: document.getElementById("promoExpiry"),
  promoLive: document.getElementById("promoLive"),
  promoList: document.getElementById("promoList"),
  productForm: document.getElementById("productForm"),
  productName: document.getElementById("productName"),
  productCategory: document.getElementById("productCategory"),
  productPrice: document.getElementById("productPrice"),
  productUnit: document.getElementById("productUnit"),
  productDescription: document.getElementById("productDescription"),
  productStock: document.getElementById("productStock"),
  productFeatured: document.getElementById("productFeatured"),
  productSignatureShowcase: document.getElementById("productSignatureShowcase"),
  productVariants: document.getElementById("productVariants"),
  productImage: document.getElementById("productImage"),
  manageProductSelect: document.getElementById("manageProductSelect"),
  manageProductForm: document.getElementById("manageProductForm"),
  manageName: document.getElementById("manageName"),
  manageCategory: document.getElementById("manageCategory"),
  managePrice: document.getElementById("managePrice"),
  manageUnit: document.getElementById("manageUnit"),
  manageDescription: document.getElementById("manageDescription"),
  manageStock: document.getElementById("manageStock"),
  manageFeatured: document.getElementById("manageFeatured"),
  manageSignatureShowcase: document.getElementById("manageSignatureShowcase"),
  deleteProductBtn: document.getElementById("deleteProductBtn"),
  variantList: document.getElementById("variantList"),
  variantForm: document.getElementById("variantForm"),
  variantName: document.getElementById("variantName"),
  variantPrice: document.getElementById("variantPrice"),
  variantStock: document.getElementById("variantStock"),
  stockControlForm: document.getElementById("stockControlForm"),
  stockProductSelect: document.getElementById("stockProductSelect"),
  stockFlag: document.getElementById("stockFlag"),
  restockQuantity: document.getElementById("restockQuantity"),
  stockVariantWrap: document.getElementById("stockVariantWrap"),
  stockVariantList: document.getElementById("stockVariantList"),
  outOfStockList: document.getElementById("outOfStockList"),
  ordersWrap: document.getElementById("ordersWrap"),
  toast: document.getElementById("toast")
};

const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "";

let adminProducts = [];
let isAdminLoginSubmitting = false;
let isPromoSubmitting = false;
let isProductSubmitting = false;
let isManageProductSubmitting = false;
let isVariantSubmitting = false;
let isStockFlagSubmitting = false;
let orderPollTimer = null;
let knownOrderIds = new Set();
let orderPollInitialized = false;
let panelAccordionInitialized = false;
let orderAlerts = [];

async function api(path, options = {}) {
  try {
    const isFormData = options.body instanceof FormData;
    const headers = isFormData
      ? { ...(options.headers || {}) }
      : { "Content-Type": "application/json", ...(options.headers || {}) };

    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  } catch (err) {
    if (err && err.name === "TypeError") {
      throw new Error("Failed to fetch. Ensure backend server is running on http://localhost:3000");
    }
    throw err;
  }
}

function resolveAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `/resources/${encodeURIComponent(raw)}`;
}

let toastTimer = null;

function toast(msg, options = {}) {
  const persistent = Boolean(options.persistent);
  const type = options.type || "info";
  if (toastTimer) clearTimeout(toastTimer);
  if (els.toast && els.toast.parentElement !== document.body) {
    document.body.appendChild(els.toast);
  }

  els.toast.classList.remove("hidden", "toast-error", "toast-success");
  if (type === "error") els.toast.classList.add("toast-error");
  if (type === "success") els.toast.classList.add("toast-success");

  if (persistent) {
    els.toast.innerHTML = `
      <div class="toast-row">
        <span>${msg}</span>
        <button type="button" class="toast-close" aria-label="Close notification">x</button>
      </div>
    `;
    const closeBtn = els.toast.querySelector(".toast-close");
    if (closeBtn) closeBtn.onclick = () => els.toast.classList.add("hidden");
    return;
  }

  els.toast.textContent = msg;
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3000);
}

function setButtonLoading(button, loading, loadingText = "Please wait...") {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="btn-loading"><span class="spinner"></span>${loadingText}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

function loadOrderAlerts() {
  try {
    const raw = localStorage.getItem("myfarms_admin_order_alerts");
    const parsed = raw ? JSON.parse(raw) : [];
    orderAlerts = Array.isArray(parsed) ? parsed : [];
  } catch {
    orderAlerts = [];
  }
}

function saveOrderAlerts() {
  localStorage.setItem("myfarms_admin_order_alerts", JSON.stringify(orderAlerts));
}

function renderOrderAlerts() {
  if (!els.newOrderAlerts) return;
  if (!orderAlerts.length) {
    els.newOrderAlerts.innerHTML = '<div class="meta">No pending order alerts.</div>';
    return;
  }

  els.newOrderAlerts.innerHTML = orderAlerts
    .map(
      (a) => `
      <article class="item order-alert">
        <div class="row" style="justify-content:space-between;">
          <strong>New Order #${String(a.orderId || "").slice(-6).toUpperCase()}</strong>
          <button type="button" class="alert-close" data-alert-id="${a.orderId}">Close</button>
        </div>
        <div class="meta">${new Date(a.createdAt).toLocaleString()}</div>
        <div class="meta">Customer: ${a.customerName || "N/A"} | Payment: ${a.paymentMethod || "N/A"}</div>
        <div class="meta">Total: Rs.${Number(a.totalAmount || 0).toFixed(2)}</div>
      </article>
    `
    )
    .join("");

  els.newOrderAlerts.querySelectorAll("button[data-alert-id]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.alertId;
      orderAlerts = orderAlerts.filter((a) => a.orderId !== id);
      saveOrderAlerts();
      renderOrderAlerts();
    };
  });
}

function addOrderAlerts(newOrders) {
  const existing = new Set(orderAlerts.map((a) => a.orderId));
  for (const o of newOrders || []) {
    if (!o || !o.id || existing.has(o.id)) continue;
    orderAlerts.unshift({
      orderId: o.id,
      createdAt: o.createdAt || new Date().toISOString(),
      customerName: o.customerName || "",
      paymentMethod: o.paymentMethod || "",
      totalAmount: Number(o.totalAmount || 0)
    });
    existing.add(o.id);
  }
  saveOrderAlerts();
  renderOrderAlerts();
}

function setupPanelAccordion() {
  if (panelAccordionInitialized) return;
  const sections = Array.from(document.querySelectorAll("#panelCard > section.card"));
  if (!sections.length) return;

  sections.forEach((section, idx) => {
    const heading = section.querySelector("h2");
    const title = heading ? heading.textContent.trim() : `Section ${idx + 1}`;
    if (heading) heading.remove();

    const body = document.createElement("div");
    body.className = "card-body";
    while (section.firstChild) {
      body.appendChild(section.firstChild);
    }
    section.appendChild(body);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "card-toggle";
    toggle.innerHTML = `<span>${title}</span><span class="card-toggle-icon">+</span>`;
    section.insertBefore(toggle, body);

    section.classList.toggle("expanded", idx === 0);
    toggle.onclick = () => {
      const shouldOpen = !section.classList.contains("expanded");
      sections.forEach((s) => s.classList.remove("expanded"));
      if (shouldOpen) section.classList.add("expanded");
    };
  });

  panelAccordionInitialized = true;
}

function openPanelSectionByContentId(contentId) {
  const body = document.getElementById(contentId);
  if (!body) return;
  const section = body.closest("#panelCard > section.card");
  if (!section) return;
  const all = Array.from(document.querySelectorAll("#panelCard > section.card"));
  all.forEach((s) => s.classList.remove("expanded"));
  section.classList.add("expanded");
}

function statusLabel(status) {
  if (status === "OUT_FOR_DELIVERY") return "Out for Delivery";
  if (status === "ORDER_READY_FOR_PICKUP") return "Order Ready for Pickup";
  if (status === "CANCELED") return "Canceled";
  if (status === "DELIVERED") return "Delivered";
  return status || "Placed";
}

function renderTrendChart(points) {
  if (!points || !points.length) {
    els.trendChart.innerHTML = '<div class="meta">No trend data for selected range.</div>';
    return;
  }

  const width = 680;
  const height = 210;
  const padL = 50;
  const padR = 18;
  const padT = 16;
  const padB = 44;
  const maxY = Math.max(...points.map((p) => Number(p.orders || 0)), 1);
  const minY = 0;

  const coords = points.map((p, i) => {
    const x = padL + (i * (width - padL - padR)) / Math.max(points.length - 1, 1);
    const y = height - padB - ((Number(p.orders || 0) - minY) / (maxY - minY || 1)) * (height - padT - padB);
    return { x, y, date: p.date, orders: Number(p.orders || 0) };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const dots = coords
    .map(
      (c) =>
        `<circle cx="${c.x}" cy="${c.y}" r="3.5" fill="#2f6b3f"><title>${c.date}: ${c.orders} orders</title></circle>`
    )
    .join("");

  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const totalOrders = points.reduce((sum, p) => sum + Number(p.orders || 0), 0);

  const yTicks = 4;
  const yAxis = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = Math.round((maxY * (yTicks - i)) / yTicks);
    const y = padT + ((height - padT - padB) * i) / yTicks;
    return { value, y };
  });
  const yTickLines = yAxis
    .map((t) => `<line x1="${padL}" y1="${t.y}" x2="${width - padR}" y2="${t.y}" stroke="#edf3ea" stroke-width="1" />`)
    .join("");
  const yTickLabels = yAxis
    .map((t) => `<text x="${padL - 8}" y="${t.y + 4}" text-anchor="end" font-size="10" fill="#4e6453">${t.value}</text>`)
    .join("");

  const xTickStep = Math.max(1, Math.floor(points.length / 6));
  const xTicks = coords
    .filter((_, i) => i % xTickStep === 0 || i === coords.length - 1)
    .map((c) => {
      const label = c.date.slice(5);
      return `<text x="${c.x}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#4e6453">${label}</text>`;
    })
    .join("");

  els.trendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg" preserveAspectRatio="none" aria-label="Orders trend line chart">
      ${yTickLines}
      <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="#cddcc8" stroke-width="1.2" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="#cddcc8" stroke-width="1.2" />
      <polyline fill="none" stroke="#2f6b3f" stroke-width="2.5" points="${polyline}" />
      ${dots}
      ${yTickLabels}
      ${xTicks}
      <text x="${width / 2}" y="${height - 2}" text-anchor="middle" font-size="11" fill="#39543f">Time (Date)</text>
      <text x="12" y="${height / 2}" text-anchor="middle" font-size="11" fill="#39543f" transform="rotate(-90 12 ${height / 2})">Orders</text>
    </svg>
    <div class="meta">Range: ${firstDate} to ${lastDate} | Total Orders: ${totalOrders}</div>
  `;
}

function setAdminUI(isAdmin) {
  if (!isAdmin && orderPollTimer) {
    clearInterval(orderPollTimer);
    orderPollTimer = null;
    knownOrderIds = new Set();
    orderPollInitialized = false;
  }
  els.loginCard.classList.toggle("hidden", isAdmin);
  els.panelCard.classList.toggle("hidden", !isAdmin);
  if (isAdmin) {
    setupPanelAccordion();
    loadOrderAlerts();
    renderOrderAlerts();
  }
  els.adminActions.innerHTML = isAdmin
    ? '<button id="logoutBtn" type="button">Logout</button>'
    : '<a href="/" style="color:#2f6b3f;text-decoration:none;font-weight:700;">Back to Store</a>';

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api("/api/admin/logout", { method: "POST" });
      if (orderPollTimer) {
        clearInterval(orderPollTimer);
        orderPollTimer = null;
      }
      knownOrderIds = new Set();
      orderPollInitialized = false;
      setAdminUI(false);
      toast("Logged out");
    };
  }
}

function buildDashboardQuery() {
  const params = new URLSearchParams();
  if (els.dashboardDateFrom.value) params.set("dateFrom", els.dashboardDateFrom.value);
  if (els.dashboardDateTo.value) params.set("dateTo", els.dashboardDateTo.value);
  if (els.dashboardStatus.value) params.set("status", els.dashboardStatus.value);
  if (els.dashboardCategory.value.trim()) params.set("category", els.dashboardCategory.value.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildOrdersQuery() {
  const params = new URLSearchParams();
  if (els.orderDateFrom.value) params.set("dateFrom", els.orderDateFrom.value);
  if (els.orderDateTo.value) params.set("dateTo", els.orderDateTo.value);
  if (els.orderStatus.value) params.set("status", els.orderStatus.value);
  if (els.orderCategory.value.trim()) params.set("category", els.orderCategory.value.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildComplaintsQuery() {
  const params = new URLSearchParams();
  if (els.complaintStatus.value) params.set("status", els.complaintStatus.value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function renderDashboard() {
  const data = await api(`/api/admin/dashboard${buildDashboardQuery()}`);
  els.kpiWrap.innerHTML = `
    <div class="kpi"><div class="meta">Today's Sales</div><strong>Rs.${Number(data.kpis.todaySales || 0).toFixed(2)}</strong></div>
    <div class="kpi"><div class="meta">Total Orders</div><strong>${data.kpis.totalOrders || 0}</strong></div>
    <div class="kpi"><div class="meta">Total Sales</div><strong>Rs.${Number(data.kpis.totalSales || 0).toFixed(2)}</strong></div>
    <div class="kpi"><div class="meta">Low Stock Items</div><strong>${data.kpis.lowStockCount || 0}</strong></div>
  `;
  els.topProducts.innerHTML = (data.topProducts || []).length
    ? data.topProducts.map((p) => `<div class="item"><strong>${p.name}</strong><span>Sold: ${p.soldQty}</span></div>`).join("")
    : '<div class="meta">No data</div>';
  els.lowStockList.innerHTML = (data.lowStockProducts || []).length
    ? data.lowStockProducts
      .map((p) => `<div class="item"><strong>${p.name}</strong><span>${p.category} | Stock: ${p.stock}</span></div>`)
      .join("")
    : '<div class="meta">No low stock products</div>';
  renderTrendChart(data.orderTrend || []);
}

async function renderOrders() {
  const data = await api(`/api/admin/orders${buildOrdersQuery()}`);
  if (!data.orders.length) {
    els.ordersWrap.innerHTML = '<p class="meta">No orders yet.</p>';
    return;
  }

  els.ordersWrap.innerHTML = data.orders
    .map(
      (o) => `
      <article class="order">
        <div class="row" style="justify-content:space-between;">
          <strong>Order #${o.id.slice(-6).toUpperCase()}</strong>
          <span class="tag">${statusLabel(o.status)}</span>
        </div>
        <div class="meta">${new Date(o.createdAt).toLocaleString()}</div>
        <div class="meta">Customer: ${o.customerName} | ${o.customerEmail} | ${o.customerPhone}</div>
        <div class="meta">Payment: ${o.paymentMethod} | Total: Rs.${Number(o.totalAmount).toFixed(2)}</div>
        <div class="meta">Address: ${o.deliveryAddress}</div>
        <div class="meta">Items: ${o.items
          .map((it) => `${it.productName}${it.variantName ? ` (${it.variantName})` : ""} x ${it.quantity}`)
          .join(", ")}</div>
        ${o.cancelNote ? `<div class="meta"><strong>Cancel Reason:</strong> ${o.cancelNote}</div>` : ""}
        <div class="row" style="margin-top:0.5rem;">
          ${o.paymentMethod === "PICKUP"
          ? `<button type="button" data-id="${o.id}" data-status="ORDER_READY_FOR_PICKUP">Order Ready for Pickup</button>`
          : `<button type="button" data-id="${o.id}" data-status="OUT_FOR_DELIVERY">Set Out for Delivery</button>`
        }
          <button type="button" data-id="${o.id}" data-status="CANCELED">Cancel Order</button>
          <button type="button" data-id="${o.id}" data-status="DELIVERED">Set Delivered</button>
        </div>
      </article>
    `
    )
    .join("");

  els.ordersWrap.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.onclick = async () => {
      setButtonLoading(btn, true, "Updating...");
      try {
        const payload = { status: btn.dataset.status };
        if (btn.dataset.status === "CANCELED") {
          const note = window.prompt("Enter cancel reason for customer notification:");
          if (!note || note.trim().length < 3) {
            toast("Cancel reason is required");
            return;
          }
          payload.cancelNote = note.trim();
        }
        await api(`/api/admin/orders/${btn.dataset.id}/status`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        toast(`Updated: ${statusLabel(btn.dataset.status)}`);
        await Promise.all([renderOrders(), renderDashboard()]);
      } catch (err) {
        toast(err.message);
      } finally {
        setButtonLoading(btn, false);
      }
    };
  });
}

function startOrderPolling() {
  if (orderPollTimer) clearInterval(orderPollTimer);

  const poll = async () => {
    try {
      const data = await api("/api/admin/orders");
      const latestIds = new Set((data.orders || []).map((o) => o.id));

      if (!orderPollInitialized) {
        knownOrderIds = latestIds;
        orderPollInitialized = true;
        return;
      }

      const newOrders = (data.orders || []).filter((o) => !knownOrderIds.has(o.id));
      const hasNewOrder = newOrders.length > 0;
      knownOrderIds = latestIds;

      if (hasNewOrder) {
        addOrderAlerts(newOrders);
        openPanelSectionByContentId("newOrderAlerts");
        toast(`New order received (${newOrders.length})`, { persistent: true, type: "success" });
        if ("Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification("My Farms Admin", { body: "New order received." });
          } else if (Notification.permission === "default") {
            Notification.requestPermission();
          }
        }
        await Promise.all([renderOrders(), renderDashboard()]);
      }
    } catch {
      // Ignore polling errors
    }
  };

  poll();
  orderPollTimer = setInterval(poll, 20000);
}

async function renderComplaints() {
  const data = await api(`/api/admin/complaints${buildComplaintsQuery()}`);
  if (!data.complaints.length) {
    els.complaintsWrap.innerHTML = '<p class="meta">No complaints found.</p>';
    return;
  }

  els.complaintsWrap.innerHTML = data.complaints
    .map(
      (c) => `
      <article class="order">
        <div class="row" style="justify-content:space-between;">
          <strong>Ticket #${c.ticketNumber}</strong>
          <span class="tag">${c.status}</span>
        </div>
        <div class="meta">${new Date(c.createdAt).toLocaleString()} | Order ${c.orderNumber}</div>
        <div class="meta">Customer: ${c.customerName} | ${c.customerEmail}</div>
        <div class="meta"><strong>Issue:</strong> ${c.issue}</div>
        ${c.proofImagePath ? `<div class="meta"><a href="${resolveAssetUrl(c.proofImagePath)}" target="_blank" rel="noreferrer">View Proof Photo</a></div>` : ""}
        <div class="meta"><strong>Timeline:</strong> ${(c.timeline || [])
          .map((t) => `${t.label} (${new Date(t.at).toLocaleString()})`)
          .join(" -> ")}</div>
        ${c.adminReply ? `<div class="meta"><strong>Last Reply:</strong> ${c.adminReply}</div>` : ""}
        ${c.closedAt ? `<div class="meta"><strong>Closed:</strong> ${new Date(c.closedAt).toLocaleString()}</div>` : ""}
        <div class="field" style="margin-top:0.5rem;">
          <label>Reply Message</label>
          <textarea id="reply-${c.id}" rows="3" placeholder="Type support reply to customer..."></textarea>
        </div>
        <div class="row">
          <button type="button" data-action="send-reply" data-id="${c.id}">Send Reply</button>
          <button type="button" data-action="send-reply-close" data-id="${c.id}">Reply + Close</button>
          ${c.status === "OPEN" ? `<button type="button" data-action="close-only" data-id="${c.id}">Close Ticket</button>` : ""}
        </div>
      </article>
    `
    )
    .join("");

  els.complaintsWrap.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.onclick = async () => {
      const complaintId = btn.dataset.id;
      const action = btn.dataset.action;
      const replyEl = document.getElementById(`reply-${complaintId}`);
      const replyMessage = replyEl ? replyEl.value.trim() : "";

      if ((action === "send-reply" || action === "send-reply-close") && replyMessage.length < 3) {
        toast("Reply should be at least 3 characters");
        return;
      }

      setButtonLoading(btn, true, "Updating...");
      try {
        await api(`/api/admin/complaints/${complaintId}/reply`, {
          method: "POST",
          body: JSON.stringify({
            replyMessage: action === "close-only" ? "" : replyMessage,
            closeTicket: action === "send-reply-close" || action === "close-only"
          })
        });
        toast("Complaint updated");
        await renderComplaints();
      } catch (err) {
        toast(err.message);
      } finally {
        setButtonLoading(btn, false);
      }
    };
  });
}

async function renderPromos() {
  const data = await api("/api/admin/promos");
  if (!data.promos.length) {
    els.promoList.innerHTML = '<div class="meta">No promo codes yet.</div>';
    return;
  }

  els.promoList.innerHTML = data.promos
    .map(
      (p) => `
      <div class="item">
        <div>
          <strong>${p.code}</strong>
          <div class="meta">${p.discountPercent}% off | Min Rs.${p.minOrderValue} | Uses ${p.usedCount}/${p.maxUses} | Expires ${new Date(
            p.expiresAt
          ).toLocaleDateString()} | ${p.showOnHomepage ? "Live on homepage" : "Hidden from homepage"}</div>
        </div>
        <div class="row">
          <button type="button" data-action="toggle-promo" data-id="${p.id}" data-active="${p.active}">
            ${p.active ? "Deactivate" : "Activate"}
          </button>
          <button type="button" data-action="toggle-promo-live" data-id="${p.id}" data-live="${p.showOnHomepage}">
            ${p.showOnHomepage ? "Hide From Live" : "Show Live"}
          </button>
          <button type="button" data-action="delete-promo" data-id="${p.id}">Delete</button>
        </div>
      </div>
    `
    )
    .join("");

  els.promoList.querySelectorAll("button[data-action='toggle-promo']").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/admin/promos/${btn.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: btn.dataset.active !== "true" })
      });
      toast("Promo updated");
      renderPromos();
    };
  });

  els.promoList.querySelectorAll("button[data-action='toggle-promo-live']").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/admin/promos/${btn.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ showOnHomepage: btn.dataset.live !== "true" })
      });
      toast("Homepage promo visibility updated");
      renderPromos();
    };
  });

  els.promoList.querySelectorAll("button[data-action='delete-promo']").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/admin/promos/${btn.dataset.id}`, { method: "DELETE" });
      toast("Promo deleted");
      renderPromos();
    };
  });
}

function getSelectedProduct() {
  const id = els.manageProductSelect.value;
  return adminProducts.find((p) => p.id === id) || null;
}

function getSelectedStockProduct() {
  const id = els.stockProductSelect.value;
  return adminProducts.find((p) => p.id === id) || null;
}

function populateProductSelects() {
  const prevManage = els.manageProductSelect.value;
  const prevStock = els.stockProductSelect.value;
  const options = adminProducts.map((p) => `<option value="${p.id}">${p.name} (${p.category})</option>`).join("");
  els.manageProductSelect.innerHTML = options;
  els.stockProductSelect.innerHTML = options;

  if (!adminProducts.length) return;

  const hasPrevManage = adminProducts.some((p) => p.id === prevManage);
  const hasPrevStock = adminProducts.some((p) => p.id === prevStock);
  els.manageProductSelect.value = hasPrevManage ? prevManage : adminProducts[0].id;
  els.stockProductSelect.value = hasPrevStock ? prevStock : adminProducts[0].id;
}

function renderSelectedProduct() {
  const p = getSelectedProduct();
  if (!p) return;
  els.manageName.value = p.name;
  els.manageCategory.value = p.category;
  els.managePrice.value = p.price;
  els.manageUnit.value = p.unit;
  els.manageDescription.value = p.description || "";
  els.manageStock.value = p.stock;
  els.manageFeatured.value = String(Boolean(p.featured));
  els.manageSignatureShowcase.value = String(Boolean(p.signatureShowcase));

  els.variantList.innerHTML = (p.variants || []).length
    ? p.variants
      .map(
        (v) => `
          <div class="variant-row">
            <input type="text" value="${v.name}" data-field="name" data-variant-id="${v.id}" />
            <input type="number" min="1" step="0.01" value="${Number(v.price)}" data-field="price" data-variant-id="${v.id}" />
            <input type="number" min="0" step="1" value="${Number(v.stock || 0)}" data-field="stock" data-variant-id="${v.id}" />
            <button type="button" data-action="save-variant" data-variant-id="${v.id}">Save</button>
            <button type="button" data-action="remove-variant" data-variant-id="${v.id}">Remove</button>
          </div>
        `
      )
      .join("")
    : '<div class="meta">No variants</div>';

  els.variantList.querySelectorAll("button[data-action='remove-variant']").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/admin/products/${p.id}/variants/${btn.dataset.variantId}`, { method: "DELETE" });
      toast("Variant removed");
      await refreshProducts();
    };
  });

  els.variantList.querySelectorAll("button[data-action='save-variant']").forEach((btn) => {
    btn.onclick = async () => {
      const variantId = btn.dataset.variantId;
      const nameInput = els.variantList.querySelector(`input[data-field='name'][data-variant-id='${variantId}']`);
      const priceInput = els.variantList.querySelector(`input[data-field='price'][data-variant-id='${variantId}']`);
      const stockInput = els.variantList.querySelector(`input[data-field='stock'][data-variant-id='${variantId}']`);
      if (!nameInput || !priceInput || !stockInput) return;

      const name = nameInput.value.trim();
      const price = Number(priceInput.value);
      const stock = Number(stockInput.value);

      if (!name || !Number.isFinite(price) || price <= 0) {
        toast("Please enter valid variant name and price");
        return;
      }
      if (!Number.isInteger(stock) || stock < 0) {
        toast("Variant stock must be a non-negative integer");
        return;
      }

      setButtonLoading(btn, true, "Saving...");
      try {
        await api(`/api/admin/products/${p.id}/variants/${variantId}`, {
          method: "PUT",
          body: JSON.stringify({ name, price, stock })
        });
        toast("Variant updated");
        await Promise.all([refreshProducts(), renderDashboard()]);
      } catch (err) {
        toast(err.message);
      } finally {
        setButtonLoading(btn, false);
      }
    };
  });
}

function renderStockControl() {
  const p = getSelectedStockProduct();
  if (!p) return;

  els.stockFlag.value = String(Boolean(p.forceOutOfStock));
  els.restockQuantity.value = String(Number(p.stock || 100) > 0 ? Number(p.stock) : 100);
  const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;

  if (hasVariants) {
    els.stockVariantWrap.classList.remove("hidden");
    els.stockVariantList.innerHTML = p.variants
      .map(
        (v) => `
        <div class="row">
          <label style="min-width: 170px;">${v.name}</label>
          <input type="number" min="0" step="1" data-variant-id="${v.id}" value="${Number(v.stock || 0)}" />
        </div>
      `
      )
      .join("");
  } else {
    els.stockVariantWrap.classList.add("hidden");
    els.stockVariantList.innerHTML = "";
  }

  els.restockQuantity.disabled = els.stockFlag.value === "true" || hasVariants;
}

function renderOutOfStockList() {
  const outItems = adminProducts.filter((p) => p.outOfStock || p.forceOutOfStock);
  if (!outItems.length) {
    els.outOfStockList.innerHTML = '<div class="meta">No products are marked out of stock.</div>';
    return;
  }

  els.outOfStockList.innerHTML = outItems
    .map(
      (p) => `
      <div class="item">
        <strong>${p.name}</strong>
        <div class="meta">${p.category} | Stock: ${p.stock} | Flag: ${p.forceOutOfStock ? "Manual" : "Auto by stock"}</div>
      </div>
    `
    )
    .join("");
}

async function refreshProducts() {
  const data = await api("/api/admin/products");
  adminProducts = data.products || [];
  populateProductSelects();
  renderSelectedProduct();
  renderStockControl();
  renderOutOfStockList();
}

async function refreshAll() {
  await Promise.all([renderDashboard(), renderOrders(), renderPromos(), refreshProducts(), renderComplaints()]);
}

els.dashboardFilterForm.onsubmit = async (e) => {
  e.preventDefault();
  await renderDashboard();
};

els.orderFilterForm.onsubmit = async (e) => {
  e.preventDefault();
  await renderOrders();
};

els.complaintFilterForm.onsubmit = async (e) => {
  e.preventDefault();
  await renderComplaints();
};

els.promoForm.onsubmit = async (e) => {
  e.preventDefault();
  if (isPromoSubmitting) return;
  isPromoSubmitting = true;
  const submitBtn = e.submitter || els.promoForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Creating...");
  try {
    await api("/api/admin/promos", {
      method: "POST",
      body: JSON.stringify({
        code: els.promoCode.value.trim(),
        discountPercent: Number(els.promoDiscount.value),
        minOrderValue: Number(els.promoMinOrder.value || 0),
        maxUses: Number(els.promoMaxUses.value),
        expiresAt: els.promoExpiry.value,
        showOnHomepage: Boolean(els.promoLive.checked)
      })
    });
    els.promoForm.reset();
    toast("Promo created");
    renderPromos();
  } catch (err) {
    toast(err.message);
  } finally {
    setButtonLoading(submitBtn, false);
    isPromoSubmitting = false;
  }
};

els.productForm.onsubmit = async (e) => {
  e.preventDefault();
  if (isProductSubmitting) return;
  isProductSubmitting = true;
  const submitBtn = e.submitter || els.productForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Adding...");
  try {
    const formData = new FormData();
    formData.append("name", els.productName.value.trim());
    formData.append("category", els.productCategory.value.trim());
    formData.append("price", els.productPrice.value.trim());
    formData.append("unit", els.productUnit.value.trim() || "kg");
    formData.append("description", els.productDescription.value.trim());
    formData.append("stock", els.productStock.value.trim());
    formData.append("featured", els.productFeatured.value);
    formData.append("signatureShowcase", els.productSignatureShowcase.value);
    formData.append("variantsJson", els.productVariants.value.trim() || "[]");
    const imageFile = els.productImage.files && els.productImage.files[0];
    if (!imageFile) throw new Error("Please select product image");
    formData.append("image", imageFile);
    await api("/api/admin/products", { method: "POST", body: formData });
    els.productForm.reset();
    els.productUnit.value = "kg";
    els.productDescription.value = "";
    els.productStock.value = "100";
    els.productFeatured.value = "false";
    els.productSignatureShowcase.value = "false";
    toast("Product added");
    await Promise.all([refreshProducts(), renderDashboard()]);
  } catch (err) {
    toast(err.message);
  } finally {
    setButtonLoading(submitBtn, false);
    isProductSubmitting = false;
  }
};

els.manageProductSelect.onchange = renderSelectedProduct;

els.manageProductForm.onsubmit = async (e) => {
  e.preventDefault();
  if (isManageProductSubmitting) return;
  isManageProductSubmitting = true;
  const submitBtn = e.submitter || els.manageProductForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Saving...");
  const p = getSelectedProduct();
  try {
    if (!p) return;
    const formData = new FormData();
    formData.append("name", els.manageName.value.trim());
    formData.append("category", els.manageCategory.value.trim());
    formData.append("price", els.managePrice.value.trim());
    formData.append("unit", els.manageUnit.value.trim());
    formData.append("description", els.manageDescription.value.trim());
    formData.append("stock", els.manageStock.value.trim());
    formData.append("featured", els.manageFeatured.value);
    formData.append("signatureShowcase", els.manageSignatureShowcase.value);
    await api(`/api/admin/products/${p.id}`, { method: "PUT", body: formData });
    toast("Product updated");
    await Promise.all([refreshProducts(), renderDashboard()]);
  } catch (err) {
    toast(err.message);
  } finally {
    setButtonLoading(submitBtn, false);
    isManageProductSubmitting = false;
  }
};

els.deleteProductBtn.onclick = async () => {
  const p = getSelectedProduct();
  if (!p) return;
  await api(`/api/admin/products/${p.id}`, { method: "DELETE" });
  toast("Product deleted");
  await Promise.all([refreshProducts(), renderDashboard()]);
};

els.variantForm.onsubmit = async (e) => {
  e.preventDefault();
  if (isVariantSubmitting) return;
  isVariantSubmitting = true;
  const submitBtn = e.submitter || els.variantForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Adding...");
  const p = getSelectedProduct();
  try {
    if (!p) return;
    await api(`/api/admin/products/${p.id}/variants`, {
      method: "POST",
      body: JSON.stringify({
        name: els.variantName.value.trim(),
        price: Number(els.variantPrice.value),
        stock: Number(els.variantStock.value)
      })
    });
    els.variantForm.reset();
    els.variantStock.value = "0";
    toast("Variant added");
    await Promise.all([refreshProducts(), renderDashboard()]);
  } catch (err) {
    toast(err.message);
  } finally {
    setButtonLoading(submitBtn, false);
    isVariantSubmitting = false;
  }
};

els.stockControlForm.onsubmit = async (e) => {
  e.preventDefault();
  if (isStockFlagSubmitting) return;
  isStockFlagSubmitting = true;
  const submitBtn = e.submitter || els.stockControlForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Updating...");
  try {
    const forceOutOfStock = els.stockFlag.value === "true";
    const restockQuantity = Number(els.restockQuantity.value);
    const selectedProduct = adminProducts.find((p) => p.id === els.stockProductSelect.value);
    const hasVariants = selectedProduct && selectedProduct.variants && selectedProduct.variants.length > 0;
    let variantQuantities = [];

    if (hasVariants) {
      variantQuantities = Array.from(els.stockVariantList.querySelectorAll("input[data-variant-id]")).map((input) => ({
        variantId: input.dataset.variantId,
        stock: Number(input.value)
      }));

      if (
        variantQuantities.length !== selectedProduct.variants.length ||
        variantQuantities.some((v) => !Number.isInteger(v.stock) || v.stock < 0)
      ) {
        toast("Please enter valid quantity for all variants");
        return;
      }

      if (forceOutOfStock && variantQuantities.some((v) => v.stock !== 0)) {
        toast("Set all variant quantities to 0 before marking product as Out Of Stock");
        return;
      }

      if (!forceOutOfStock && variantQuantities.every((v) => v.stock === 0)) {
        toast("At least one variant quantity should be greater than 0");
        return;
      }
    } else if (!forceOutOfStock && (!Number.isInteger(restockQuantity) || restockQuantity <= 0)) {
      toast("Please enter valid restock quantity");
      return;
    }

    await api(`/api/admin/products/${els.stockProductSelect.value}/stock-flag`, {
      method: "PATCH",
      body: JSON.stringify({ forceOutOfStock, restockQuantity, variantQuantities })
    });
    toast(forceOutOfStock ? "Product marked out of stock" : "Product restocked successfully");
    await refreshProducts();
  } catch (err) {
    toast(err.message);
  } finally {
    setButtonLoading(submitBtn, false);
    isStockFlagSubmitting = false;
  }
};

els.stockProductSelect.onchange = renderStockControl;

els.stockFlag.onchange = () => {
  const p = getSelectedStockProduct();
  const hasVariants = p && p.variants && p.variants.length > 0;
  els.restockQuantity.disabled = els.stockFlag.value === "true" || hasVariants;
};

els.adminLoginForm.onsubmit = async (e) => {
  e.preventDefault();
  if (isAdminLoginSubmitting) return;
  isAdminLoginSubmitting = true;
  const submitBtn = e.submitter || els.adminLoginForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true, "Logging in...");
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email: els.adminEmail.value, password: els.adminPassword.value })
    });
    setAdminUI(true);
    await refreshAll();
    orderPollInitialized = false;
    startOrderPolling();
    toast("Admin login successful");
    els.adminLoginForm.reset();
  } catch (err) {
    toast(err.message);
  } finally {
    setButtonLoading(submitBtn, false);
    isAdminLoginSubmitting = false;
  }
};

(async function init() {
  try {
    const data = await api("/api/admin/me");
    const isAdmin = Boolean(data.admin);
    setAdminUI(isAdmin);
    if (isAdmin) {
      await refreshAll();
      orderPollInitialized = false;
      startOrderPolling();
    }
  } catch {
    setAdminUI(false);
  }
})();
