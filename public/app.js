const state = {
  products: [],
  cart: [],
  user: null,
  authMode: "login",
  selectedCategory: "All",
  searchQuery: "",
  variantTarget: null
};

const els = {
  navActions: document.getElementById("navActions"),
  categoryFilters: document.getElementById("categoryFilters"),
  productSearch: document.getElementById("productSearch"),
  productsGrid: document.getElementById("productsGrid"),
  cartItems: document.getElementById("cartItems"),
  cartTotal: document.getElementById("cartTotal"),
  checkoutBtn: document.getElementById("checkoutBtn"),
  ordersList: document.getElementById("ordersList"),
  authModal: document.getElementById("authModal"),
  authForm: document.getElementById("authForm"),
  authTitle: document.getElementById("authTitle"),
  authSubmit: document.getElementById("authSubmit"),
  toggleAuthMode: document.getElementById("toggleAuthMode"),
  forgotBtn: document.getElementById("forgotBtn"),
  nameField: document.getElementById("nameField"),
  termsField: document.getElementById("termsField"),
  authTerms: document.getElementById("authTerms"),
  authName: document.getElementById("authName"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  variantModal: document.getElementById("variantModal"),
  variantTitle: document.getElementById("variantTitle"),
  variantOptions: document.getElementById("variantOptions"),
  checkoutModal: document.getElementById("checkoutModal"),
  checkoutForm: document.getElementById("checkoutForm"),
  checkoutFullName: document.getElementById("checkoutFullName"),
  checkoutContact: document.getElementById("checkoutContact"),
  checkoutTip: document.getElementById("checkoutTip"),
  paymentMethod: document.getElementById("paymentMethod"),
  addressField: document.getElementById("addressField"),
  deliveryAddress: document.getElementById("deliveryAddress"),
  forgotModal: document.getElementById("forgotModal"),
  forgotForm: document.getElementById("forgotForm"),
  forgotEmail: document.getElementById("forgotEmail"),
  toast: document.getElementById("toast")
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function openModal(el) {
  el.classList.remove("hidden");
}

function closeModal(el) {
  el.classList.add("hidden");
}

function computeTotal() {
  return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function renderNav() {
  if (state.user) {
    els.navActions.innerHTML = `
      <span class="small muted">Hi ${state.user.name}, thanks for choosing My Farms</span>
      <button class="btn-ghost" id="logoutBtn">Logout</button>
    `;
    document.getElementById("logoutBtn").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      renderNav();
      renderOrders();
      showToast("Logged out");
    };
  } else {
    els.navActions.innerHTML = `<button class="btn-primary" id="loginBtn">Login / Signup</button>`;
    document.getElementById("loginBtn").onclick = () => openModal(els.authModal);
  }
}

function renderFilters() {
  const categories = ["All", ...new Set(state.products.map((p) => p.category))];
  els.categoryFilters.innerHTML = categories
    .map(
      (c) =>
        `<button class="btn-tag ${state.selectedCategory === c ? "active" : ""}" data-category="${c}">${c}</button>`
    )
    .join("");

  els.categoryFilters.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      state.selectedCategory = btn.dataset.category;
      renderFilters();
      renderProducts();
    };
  });
}

function addToCart(product, variant = null) {
  const key = `${product.id}::${variant || ""}`;
  const existing = state.cart.find((c) => c.key === key);
  const price = variant ? variant.price : product.price;

  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({
      key,
      productId: product.id,
      name: product.name,
      variant: variant ? variant.name : null,
      price,
      quantity: 1
    });
  }

  renderCart();
  showToast("Added to cart");
}

function getProductImagePath(productName) {
  const key = String(productName || "").toLowerCase();
  const mapping = [
    { match: "mango", file: "mango.jpg" },
    { match: "banana", file: "banana.jpg" },
    { match: "watermelon", file: "watermelon.png" },
    { match: "coconut", file: "coconut.jpg" },
    { match: "chikoo", file: "chikoo.jpg" },
    { match: "custard apple", file: "Custard Apple.jpg" },
    { match: "organic groundnut oil", file: "groundnutoil.jpg" },
    { match: "groundnut oil", file: "groundnutoil.jpg" }
  ];

  const found = mapping.find((m) => key.includes(m.match));
  return found ? `/resources/${encodeURIComponent(found.file)}` : "";
}

function renderProducts() {
  const query = state.searchQuery.trim().toLowerCase();
  const list = state.products.filter((p) => {
    const categoryMatch = state.selectedCategory === "All" || p.category === state.selectedCategory;
    const searchMatch =
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.category.toLowerCase().includes(query) ||
      p.variants.some((v) => v.name.toLowerCase().includes(query));
    return categoryMatch && searchMatch;
  });

  els.productsGrid.innerHTML = list
    .map(
      (p) => `
      <article class="product-card">
        ${getProductImagePath(p.name)
          ? `<img class="product-image" src="${getProductImagePath(p.name)}" alt="${p.name}" onerror="this.style.display='none'" />`
          : ""}
        <span class="badge">${p.category}</span>
        <h4>${p.name}</h4>
        <p class="price">Rs.${p.price}/${p.unit}</p>
        <button class="btn-primary" data-add="${p.id}">${p.variants.length ? "Choose Variant" : "Add to Cart"}</button>
      </article>
    `
    )
    .join("");

  els.productsGrid.querySelectorAll("[data-add]").forEach((btn) => {
    btn.onclick = () => {
      const product = state.products.find((p) => p.id === btn.dataset.add);
      if (!product) return;

      if (product.variants.length) {
        state.variantTarget = product;
        renderVariantModal(product);
        openModal(els.variantModal);
      } else {
        addToCart(product);
      }
    };
  });
}

function renderVariantModal(product) {
  els.variantTitle.textContent = `Choose ${product.name} Variant`;
  els.variantOptions.innerHTML = product.variants
    .map(
      (v, idx) => `
      <div class="cart-item">
        <div>
          <strong>${v.name}</strong>
          <div class="small muted">Rs.${v.price}/${product.unit}</div>
        </div>
        <button class="btn-primary" data-variant="${idx}">Add</button>
      </div>
    `
    )
    .join("");

  els.variantOptions.querySelectorAll("[data-variant]").forEach((btn) => {
    btn.onclick = () => {
      const variant = product.variants[Number(btn.dataset.variant)];
      addToCart(product, variant);
      closeModal(els.variantModal);
    };
  });
}

function renderCart() {
  if (!state.cart.length) {
    els.cartItems.innerHTML = `<p class="muted small">Your cart is empty.</p>`;
  } else {
    els.cartItems.innerHTML = state.cart
      .map(
        (item, idx) => `
      <div class="cart-item">
        <div>
          <strong>${item.name}${item.variant ? ` (${item.variant})` : ""}</strong>
          <div class="small muted">Rs.${item.price} x ${item.quantity}</div>
        </div>
        <div>
          <button class="btn-ghost small" data-minus="${idx}">-</button>
          <button class="btn-ghost small" data-plus="${idx}">+</button>
        </div>
      </div>
    `
      )
      .join("");

    els.cartItems.querySelectorAll("[data-minus]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.minus);
        state.cart[i].quantity -= 1;
        if (state.cart[i].quantity <= 0) state.cart.splice(i, 1);
        renderCart();
      };
    });

    els.cartItems.querySelectorAll("[data-plus]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.plus);
        state.cart[i].quantity += 1;
        renderCart();
      };
    });
  }

  els.cartTotal.textContent = `Rs.${computeTotal().toFixed(2)}`;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  els.authTitle.textContent = signup ? "Create Account" : "Login";
  els.authSubmit.textContent = signup ? "Signup" : "Login";
  els.toggleAuthMode.textContent = signup ? "Already have account" : "Create account";
  els.nameField.classList.toggle("hidden", !signup);
  els.termsField.classList.toggle("hidden", !signup);
  els.authTerms.required = signup;
  if (!signup) els.authTerms.checked = false;
}

async function renderOrders() {
  if (!state.user) {
    els.ordersList.innerHTML = `<p class="muted small">Login to view your orders.</p>`;
    return;
  }

  try {
    const data = await api("/api/orders/my");
    if (!data.orders.length) {
      els.ordersList.innerHTML = `<p class="muted small">No orders yet.</p>`;
      return;
    }

    els.ordersList.innerHTML = data.orders
      .map(
        (o) => `
      <div class="order-card">
        <strong>Order #${o.id.slice(-6).toUpperCase()}</strong>
        <div class="small muted">${new Date(o.createdAt).toLocaleString()}</div>
        <div class="small">Payment: ${o.paymentMethod}</div>
        <div class="small">Address: ${o.deliveryAddress}</div>
        <div class="small"><strong>Total: Rs.${Number(o.totalAmount).toFixed(2)}</strong></div>
      </div>
    `
      )
      .join("");
  } catch (_err) {
    els.ordersList.innerHTML = `<p class="muted small">Failed to load orders.</p>`;
  }
}

async function init() {
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(document.getElementById(btn.dataset.close));
  });

  els.checkoutBtn.onclick = () => {
    if (!state.cart.length) {
      showToast("Cart is empty");
      return;
    }
    if (!state.user) {
      openModal(els.authModal);
      showToast("Please login or signup first");
      return;
    }
    if (!els.checkoutFullName.value.trim()) {
      els.checkoutFullName.value = state.user.name || "";
    }
    openModal(els.checkoutModal);
  };

  els.productSearch.oninput = () => {
    state.searchQuery = els.productSearch.value;
    renderProducts();
  };

  els.paymentMethod.onchange = () => {
    const pickup = els.paymentMethod.value === "PICKUP";
    els.addressField.classList.toggle("hidden", pickup);
    if (pickup) els.deliveryAddress.value = "";
  };

  els.checkoutForm.onsubmit = async (e) => {
    e.preventDefault();

    try {
      const payload = {
        fullName: els.checkoutFullName.value.trim(),
        contactNumber: els.checkoutContact.value.trim(),
        tipAmount: Number(els.checkoutTip.value || 0),
        paymentMethod: els.paymentMethod.value,
        address: els.deliveryAddress.value,
        items: state.cart.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
          variant: c.variant
        }))
      };
      if (payload.fullName.length < 2) {
        showToast("Please enter full name");
        return;
      }
      if (!/^[\d\s()+-]{7,}$/.test(payload.contactNumber)) {
        showToast("Please enter valid contact number");
        return;
      }
      if (!Number.isFinite(payload.tipAmount) || payload.tipAmount < 0 || payload.tipAmount > 5000) {
        showToast("Tip should be between 0 and 5000");
        return;
      }

      const data = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      state.cart = [];
      renderCart();
      els.checkoutTip.value = "";
      closeModal(els.checkoutModal);
      showToast(`Order placed successfully (#${data.orderId.slice(-6).toUpperCase()})`);
      renderOrders();
    } catch (err) {
      showToast(err.message);
    }
  };

  els.toggleAuthMode.onclick = () => setAuthMode(state.authMode === "login" ? "signup" : "login");

  els.forgotBtn.onclick = () => {
    closeModal(els.authModal);
    openModal(els.forgotModal);
  };

  els.forgotForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const email = els.forgotEmail.value.trim();
      if (!isValidEmail(email)) {
        showToast("Please enter a valid email address");
        return;
      }

      const data = await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });

      let targetUrl = data.redirectTo || "/reset-password.html";
      if (data.resetToken) {
        targetUrl = `${targetUrl}?token=${encodeURIComponent(data.resetToken)}&email=${encodeURIComponent(email)}`;
      }
      closeModal(els.forgotModal);
      els.forgotForm.reset();
      showToast(data.message || "Password reset process started");
      window.location.href = targetUrl;
    } catch (err) {
      showToast(err.message);
    }
  };

  els.authForm.onsubmit = async (e) => {
    e.preventDefault();

    try {
      const email = els.authEmail.value.trim();
      if (!isValidEmail(email)) {
        showToast("Please enter a valid email address");
        return;
      }

      const payload = {
        email,
        password: els.authPassword.value
      };

      let endpoint = "/api/auth/login";
      if (state.authMode === "signup") {
        const name = els.authName.value.trim();
        if (!name) {
          showToast("Name is required for signup");
          return;
        }
        if (!els.authTerms.checked) {
          showToast("Please accept My Farms Terms and Conditions");
          return;
        }
        payload.name = name;
        payload.termsAccepted = true;
        endpoint = "/api/auth/signup";
      }

      const data = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      state.user = data.user;
      closeModal(els.authModal);
      renderNav();
      renderOrders();
      showToast(`Hi ${state.user.name}, thanks for choosing My Farms`);
      els.authForm.reset();
      els.authTerms.checked = false;
      setAuthMode("login");
    } catch (err) {
      showToast(err.message);
    }
  };

  const [productsRes, meRes] = await Promise.all([api("/api/products"), api("/api/auth/me")]);
  state.products = productsRes.products;
  state.user = meRes.user;

  renderNav();
  renderFilters();
  renderProducts();
  renderCart();
  renderOrders();
}

setAuthMode("login");
init();
