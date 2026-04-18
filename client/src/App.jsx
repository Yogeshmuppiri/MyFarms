import { useEffect, useMemo, useRef, useState } from "react";

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(path, {
    headers,
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isAllowedCustomerEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!isValidEmail(normalized)) return false;
  const domain = normalized.split("@")[1] || "";
  return domain === "gmail.com" || domain === "yahoo.com";
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `/resources/${encodeURIComponent(raw)}`;
}

function getProductImagePath(productName, files) {
  if (!files?.length) return "";

  const aliasMap = {
    chikoosapota: "chikoo",
    tomatoes: "tomato",
    potato: "potatoes",
    paneer: "panner",
    okrabendi: "okra",
    freshmilk: "milk",
    eggs: "fresheggs",
    longeggplant: "longeggplant",
    organicgroundnutoilbulldriven: "groundnutoil",
    sweetcorn: "sweetcorn",
    redchilli: "redchilli",
    greenchilli: "greenchili",
    bottlegourd: "bottlegourd",
    bittergourd: "bittergourd",
    ridgegourd: "ridgegourd",
    broilerchicken: "broiler",
    natukodichicken: "natukodi",
    fish: "fishe"
  };

  const raw = normalizeToken(productName);
  const token = aliasMap[raw] || raw;

  let bestFile = "";
  let bestScore = 0;

  for (const file of files) {
    const fileToken = normalizeToken(file.replace(/\.[^.]+$/, ""));
    let score = 0;

    if (fileToken === token) score = 100;
    else if (fileToken.includes(token)) score = 80;
    else if (token.includes(fileToken)) score = 70;
    else if (token.split(/(?=[0-9])|(?<=[0-9])/).some((part) => part && fileToken.includes(part))) score = 40;

    if (score > bestScore) {
      bestScore = score;
      bestFile = file;
    }
  }

  return bestFile ? `/resources/${encodeURIComponent(bestFile)}` : "";
}

function statusLabel(status) {
  if (status === "OUT_FOR_DELIVERY") return "Out for Delivery";
  if (status === "ORDER_READY_FOR_PICKUP") return "Order Ready for Pickup";
  if (status === "CANCELED") return "Canceled";
  if (status === "DELIVERED") return "Delivered";
  return status || "Placed";
}

const TAX_RATE = 0.05;
const CUSTOMER_IDLE_MS = 30 * 60 * 1000;
const LAST_ACTIVITY_KEY = "myfarms_last_activity_at";
const DEFAULT_SEARCH_HINTS = [
  "Search for milk",
  "Search for eggs",
  "Search for chicken"
];

function getShowcaseAccent(category) {
  const key = String(category || "").trim().toLowerCase();
  if (key.includes("dairy")) return "#d9efe8";
  if (key.includes("oil")) return "#f0d1a0";
  if (key.includes("honey")) return "#f3d08d";
  if (key.includes("egg")) return "#f6e3b7";
  if (key.includes("fruit")) return "#f7d6b6";
  if (key.includes("vegetable")) return "#d7edc5";
  return "#f5e6b7";
}

export default function App() {
  const [products, setProducts] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [livePromos, setLivePromos] = useState([]);
  const [cart, setCart] = useState([]);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortBy, setSortBy] = useState("none");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [animatedSearchHint, setAnimatedSearchHint] = useState(DEFAULT_SEARCH_HINTS[0]);
  const [orders, setOrders] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [toast, setToast] = useState("");
  const [promoPreview, setPromoPreview] = useState({ valid: false, code: "", discountAmount: 0, message: "" });
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFilterCompact, setIsFilterCompact] = useState(false);

  const [showAuth, setShowAuth] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showOrderHistory, setShowOrderHistory] = useState(false);
  const [showMyComplaints, setShowMyComplaints] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [heroCarouselIndex, setHeroCarouselIndex] = useState(0);
  const [promoCarouselIndex, setPromoCarouselIndex] = useState(0);
  const [showOrderCelebration, setShowOrderCelebration] = useState(false);
  const [celebrationOrderCode, setCelebrationOrderCode] = useState("");
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isComplaintSubmitting, setIsComplaintSubmitting] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const productsSectionRef = useRef(null);

  const [previewProduct, setPreviewProduct] = useState(null);
  const [previewVariantName, setPreviewVariantName] = useState("");

  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [verificationForm, setVerificationForm] = useState({ email: "", code: "", devCode: "" });
  const [forgotEmail, setForgotEmail] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", email: "", mobileNumber: "" });
  const [complaintForm, setComplaintForm] = useState({ orderNumber: "", issue: "", proofImage: null });
  const [checkout, setCheckout] = useState({
    fullName: "",
    contactNumber: "",
    tipAmount: "",
    promoCode: "",
    paymentMethod: "COD",
    address: ""
  });

  const categories = useMemo(() => ["All", ...new Set(products.map((p) => p.category))], [products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let result = products.filter((p) => {
      const categoryMatch = selectedCategory === "All" || p.category === selectedCategory;
      const featuredMatch = !featuredOnly || p.featured;
      const searchMatch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        p.variants.some((v) => v.name.toLowerCase().includes(query));
      return categoryMatch && featuredMatch && searchMatch;
    });

    if (sortBy === "none") result = [...result];
    else if (sortBy === "priceAsc") result = [...result].sort((a, b) => Number(a.price) - Number(b.price));
    else if (sortBy === "priceDesc") result = [...result].sort((a, b) => Number(b.price) - Number(a.price));
    else if (sortBy === "popularity") result = [...result].sort((a, b) => Number(b.orderCount || 0) - Number(a.orderCount || 0));
    else result = [...result].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return result;
  }, [products, selectedCategory, featuredOnly, searchQuery, sortBy]);

  const featuredProducts = useMemo(() => filteredProducts.filter((p) => p.featured), [filteredProducts]);
  const searchHints = useMemo(() => {
    const seenNames = new Set();
    const dynamicHints = products
      .map((product) => String(product.name || "").trim())
      .filter((name) => {
        if (!name) return false;
        const key = name.toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      })
      .slice(0, 12)
      .map((name) => `Search for ${name}`);

    return dynamicHints.length ? dynamicHints : DEFAULT_SEARCH_HINTS;
  }, [products]);

  const heroShowcaseSource = useMemo(() => {
    const adminSelected = products
      .filter((p) => p.signatureShowcase && !p.outOfStock)
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        tag: p.featured ? "Customer favorite" : (p.category || "Farm fresh"),
        image: p.imagePath ? resolveAssetUrl(p.imagePath) : getProductImagePath(p.name, imageFiles),
        accent: getShowcaseAccent(p.category)
      }))
      .filter((item) => item.image);

    return adminSelected;
  }, [products, imageFiles]);

  const heroCarouselItems = useMemo(() => {
    const total = heroShowcaseSource.length;
    return heroShowcaseSource.map((item, index) => {
      let offset = index - heroCarouselIndex;
      if (offset > total / 2) offset -= total;
      if (offset < -total / 2) offset += total;
      return { ...item, offset };
    }).sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset));
  }, [heroCarouselIndex, heroShowcaseSource]);

  const activePromo = livePromos.length ? livePromos[promoCarouselIndex % livePromos.length] : null;

  const cartSubtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const cartItemCount = useMemo(() => cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0), [cart]);
  const parsedTip = Number(checkout.tipAmount || 0);
  const discountAmount = Number(promoPreview.discountAmount || 0);
  const taxableAmount = cartSubtotal - discountAmount;
  const taxAmount = taxableAmount * TAX_RATE;
  const checkoutTotal = taxableAmount + taxAmount + (Number.isFinite(parsedTip) ? parsedTip : 0);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }

  function openCheckoutFlow() {
    if (!cart.length) {
      showToast("Cart is empty");
      return;
    }
    if (!user) {
      setShowAuth(true);
      showToast("Please login or signup first");
      return;
    }
    setCheckout((prev) => ({ ...prev, fullName: prev.fullName || user.name || "" }));
    setShowCheckout(true);
  }

  function openProductPreview(product) {
    if (!product) return;
    setPreviewProduct(product);
    const firstAvailableVariant = (product.variants || []).find((v) => Number(v.stock || 0) > 0);
    setPreviewVariantName(firstAvailableVariant?.name || product.variants?.[0]?.name || "");
  }

  function closeProductPreview() {
    setPreviewProduct(null);
    setPreviewVariantName("");
  }

  function openVerificationStep(email, devCode = "") {
    setVerificationForm({ email: String(email || "").trim(), code: "", devCode: devCode || "" });
    setAuthMode("verify");
    setShowAuth(true);
  }

  async function logoutUser(message = "Logged out") {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout API failures; client state should still clear.
    }
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    setUser(null);
    setOrders([]);
    setComplaints([]);
    setShowOrderHistory(false);
    setShowMyComplaints(false);
    setCheckout((prev) => ({ ...prev, fullName: "", contactNumber: "" }));
    showToast(message);
  }

  function addToCart(product, variant = null) {
    if (product.outOfStock) {
      showToast("Product is out of stock");
      return;
    }
    if (variant && Number(variant.stock || 0) <= 0) {
      showToast("Variant is out of stock");
      return;
    }

    const key = `${product.id}::${variant?.name || ""}`;
    const price = variant ? variant.price : product.price;

    setCart((prev) => {
      const existing = prev.find((c) => c.key === key);
      if (existing) {
        return prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [
        ...prev,
        {
          key,
          productId: product.id,
          name: product.name,
          variant: variant ? variant.name : null,
          price,
          quantity: 1
        }
      ];
    });

    showToast("Added to cart");
  }

  async function applyPromoCode() {
    const code = checkout.promoCode.trim();
    if (!code) {
      setPromoPreview({ valid: false, code: "", discountAmount: 0, message: "No promo applied" });
      return;
    }

    try {
      const data = await api(`/api/promos/validate?code=${encodeURIComponent(code)}&subtotal=${cartSubtotal}`);
      setPromoPreview({
        valid: Boolean(data.valid),
        code: data.code || code.toUpperCase(),
        discountAmount: Number(data.discountAmount || 0),
        message: data.valid ? `Promo applied: ${data.discountPercent}% off` : "Promo not applied"
      });
    } catch (err) {
      setPromoPreview({ valid: false, code: "", discountAmount: 0, message: err.message });
      showToast(err.message);
    }
  }

  async function reorderOrder(orderId) {
    try {
      const data = await api(`/api/orders/${orderId}/reorder`, { method: "POST" });
      const next = [];
      for (const item of data.items || []) {
        const product = products.find((p) => p.id === item.productId);
        if (!product || product.outOfStock) continue;

        const variant = item.variant ? (product.variants || []).find((v) => v.name === item.variant) : null;
        if (item.variant && !variant) continue;
        if (variant && Number(variant.stock || 0) <= 0) continue;

        const price = variant ? variant.price : product.price;
        next.push({
          key: `${product.id}::${variant?.name || ""}`,
          productId: product.id,
          name: product.name,
          variant: variant ? variant.name : null,
          price,
          quantity: Math.max(1, Number(item.quantity || 1))
        });
      }

      if (!next.length) {
        showToast("No items available for reorder");
        return;
      }

      setCart((prev) => {
        const map = new Map(prev.map((p) => [p.key, { ...p }]));
        for (const item of next) {
          if (map.has(item.key)) map.get(item.key).quantity += item.quantity;
          else map.set(item.key, item);
        }
        return Array.from(map.values());
      });
      showToast("Items added to cart from order history");
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderProductCard(p) {
    const imagePath = p.imagePath ? resolveAssetUrl(p.imagePath) : getProductImagePath(p.name, imageFiles);

    return (
      <article
        className="product-card"
        key={p.id}
        role="button"
        tabIndex={0}
        onClick={() => openProductPreview(p)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openProductPreview(p);
          }
        }}
      >
        <span className="product-card-glow" aria-hidden="true" />
        <span className="product-card-sheen" aria-hidden="true" />
        <div className="product-media">
          <span className="product-orbit product-orbit-a" aria-hidden="true" />
          <span className="product-orbit product-orbit-b" aria-hidden="true" />
          <span className="product-stage" aria-hidden="true" />
          {imagePath ? (
            <img
              className="product-image"
              src={imagePath}
              alt={p.name}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
        </div>
        <div className="product-card-body">
          <div className="product-meta-row">
            <span className="badge">{p.category}</span>
            {p.outOfStock ? <span className="stock-badge">Out of Stock</span> : null}
          </div>
          <h4>{p.name}</h4>
          <p className="price">Rs.{p.price}/{p.unit}</p>
          <button
            className="btn-primary"
            disabled={p.outOfStock}
            onClick={(e) => {
              e.stopPropagation();
              addToCart(p);
            }}
          >
            {p.outOfStock ? "Unavailable" : "Add to Cart"}
          </button>
        </div>
      </article>
    );
  }

  async function loadOrders() {
    if (!user) {
      setOrders([]);
      return;
    }

    try {
      const data = await api("/api/orders/my");
      setOrders(data.orders || []);
    } catch {
      setOrders([]);
    }
  }

  async function loadComplaints() {
    if (!user) {
      setComplaints([]);
      return;
    }

    try {
      const data = await api("/api/complaints/my");
      setComplaints(data.complaints || []);
    } catch {
      setComplaints([]);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [productsRes, meRes, imagesRes, promosRes] = await Promise.allSettled([
          api("/api/products"),
          api("/api/auth/me"),
          api("/api/resources/images"),
          api("/api/promos/live")
        ]);

        const productsData = productsRes.status === "fulfilled" ? productsRes.value : { products: [] };
        const meData = meRes.status === "fulfilled" ? meRes.value : { user: null };
        const imagesData = imagesRes.status === "fulfilled" ? imagesRes.value : { files: [] };
        const promosData = promosRes.status === "fulfilled" ? promosRes.value : { promos: [] };

        setProducts(productsData.products || []);
        setUser(meData.user || null);
        setImageFiles(imagesData.files || []);
        setLivePromos(promosData.promos || []);
        if (meData.user?.name) {
          setCheckout((prev) => ({
            ...prev,
            fullName: meData.user.name,
            contactNumber: meData.user.mobileNumber || prev.contactNumber
          }));
          setProfileForm({
            name: meData.user.name || "",
            email: meData.user.email || "",
            mobileNumber: meData.user.mobileNumber || ""
          });
        }
      } finally {
        setIsInitialLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const productsTop = productsSectionRef.current?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      setIsFilterCompact(productsTop <= 150);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) return undefined;

    const intervalId = window.setInterval(() => {
      setHeroCarouselIndex((current) => (current + 1) % Math.max(heroShowcaseSource.length, 1));
    }, 2600);

    return () => window.clearInterval(intervalId);
  }, [heroShowcaseSource.length]);

  useEffect(() => {
    if (livePromos.length <= 1) return undefined;
    const intervalId = window.setInterval(() => {
      setPromoCarouselIndex((current) => (current + 1) % livePromos.length);
    }, 3800);
    return () => window.clearInterval(intervalId);
  }, [livePromos.length]);

  useEffect(() => {
    if (promoCarouselIndex >= livePromos.length) {
      setPromoCarouselIndex(0);
    }
  }, [promoCarouselIndex, livePromos.length]);

  useEffect(() => {
    if (heroCarouselIndex >= heroShowcaseSource.length) {
      setHeroCarouselIndex(0);
    }
  }, [heroCarouselIndex, heroShowcaseSource.length]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setAnimatedSearchHint("");
      return undefined;
    }

    let isCancelled = false;
    let hintIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let timeoutId;

    const tick = () => {
      if (isCancelled) return;

      const phrase = searchHints[hintIndex] || DEFAULT_SEARCH_HINTS[0];

      if (!isDeleting) {
        charIndex += 1;
        setAnimatedSearchHint(phrase.slice(0, charIndex));

        if (charIndex >= phrase.length) {
          isDeleting = true;
          timeoutId = window.setTimeout(tick, 900);
        } else {
          timeoutId = window.setTimeout(tick, 68);
        }
        return;
      }

      charIndex -= 1;
      setAnimatedSearchHint(phrase.slice(0, Math.max(charIndex, 0)));

      if (charIndex <= 0) {
        isDeleting = false;
        hintIndex = (hintIndex + 1) % searchHints.length;
        timeoutId = window.setTimeout(tick, 180);
      } else {
        timeoutId = window.setTimeout(tick, 32);
      }
    };

    setAnimatedSearchHint("");
    timeoutId = window.setTimeout(tick, 220);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery, searchHints]);

  useEffect(() => {
    loadOrders();
    loadComplaints();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setShowOrderHistory(false);
      setShowMyComplaints(false);
      setExpandedOrders({});
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setProfileForm({
      name: user.name || "",
      email: user.email || "",
      mobileNumber: user.mobileNumber || ""
    });
    setCheckout((prev) => ({ ...prev, fullName: user.name || "", contactNumber: user.mobileNumber || "" }));
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    let loggedOut = false;

    const markActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    };

    const checkIdle = () => {
      if (loggedOut) return;
      const storedActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || lastActivityRef.current || Date.now());
      const lastActivity = Number.isFinite(storedActivity) ? storedActivity : Date.now();
      lastActivityRef.current = lastActivity;
      if (Date.now() - lastActivity >= CUSTOMER_IDLE_MS) {
        loggedOut = true;
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        logoutUser("Logged out due to 30 minutes of inactivity");
      }
    };

    const activityEvents = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    document.addEventListener("visibilitychange", checkIdle);
    const interval = setInterval(checkIdle, 60 * 1000);
    const existingActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || Date.now());
    lastActivityRef.current = Number.isFinite(existingActivity) ? existingActivity : Date.now();
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      markActivity();
    }
    checkIdle();

    return () => {
      clearInterval(interval);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
      document.removeEventListener("visibilitychange", checkIdle);
    };
  }, [user]);

  useEffect(() => {
    if (!checkout.promoCode.trim()) {
      setPromoPreview({ valid: false, code: "", discountAmount: 0, message: "No promo applied" });
    }
  }, [checkout.promoCode, cartSubtotal]);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll(".reveal-on-scroll"));
    if (!nodes.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [isInitialLoading, filteredProducts.length, orders.length, complaints.length]);

  return (
    <>
      <header className="hero">
        <div className="hero-ambient" aria-hidden="true">
          <div className="sun-glow" />
          <div className="sun-rays" />
          <span className="cloud cloud-a" />
          <span className="cloud cloud-b" />
          <span className="cloud cloud-c" />
          <span className="pollen p1" />
          <span className="pollen p2" />
          <span className="pollen p3" />
          <span className="pollen p4" />
          <span className="pollen p5" />
          <span className="pollen p6" />
        </div>
        <div className="hero-crops" aria-hidden="true">
          <svg className="farmscape-svg" viewBox="0 0 1600 220" preserveAspectRatio="none">
            <defs>
              <linearGradient id="fieldGreen" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#9fd37f" />
                <stop offset="100%" stopColor="#4e9e58" />
              </linearGradient>
              <linearGradient id="fieldDark" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#2f7d46" />
                <stop offset="100%" stopColor="#1f5e35" />
              </linearGradient>
              <linearGradient id="pathSoil" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#dfcc8f" />
                <stop offset="100%" stopColor="#c7aa66" />
              </linearGradient>
            </defs>

            <path d="M0 130 C160 105 280 148 430 128 C650 99 740 148 880 130 C1045 108 1140 150 1300 134 C1420 122 1510 146 1600 134 L1600 220 L0 220 Z" fill="url(#fieldGreen)" />
            <path d="M0 162 C180 136 300 186 500 158 C690 131 840 182 1030 156 C1230 128 1410 182 1600 160 L1600 220 L0 220 Z" fill="#76bb64" opacity="0.95" />
            <path d="M0 186 C230 170 410 218 640 193 C900 165 1160 220 1600 192 L1600 220 L0 220 Z" fill="url(#fieldDark)" />

            <path d="M520 220 C580 182 672 184 742 220 Z" fill="url(#pathSoil)" />
            <path d="M560 220 C626 194 676 194 724 220 Z" fill="#e8daaa" opacity="0.6" />

            <g transform="translate(942 42)">
              <rect x="0" y="44" width="4" height="58" fill="#67826f" />
              <g className="windmill-blades">
                <polygon points="2,44 -20,24 -8,20 4,38" fill="#1f2622" />
                <polygon points="2,44 24,24 12,20 0,38" fill="#1f2622" />
                <polygon points="2,44 -20,64 -8,68 4,50" fill="#1f2622" />
                <polygon points="2,44 24,64 12,68 0,50" fill="#1f2622" />
              </g>
            </g>

            <g transform="translate(380 74)">
              <ellipse cx="30" cy="64" rx="34" ry="24" fill="#2e7e45" />
              <ellipse cx="56" cy="52" rx="26" ry="20" fill="#4c9d4f" />
              <ellipse cx="14" cy="50" rx="24" ry="18" fill="#62b35a" />
              <rect x="26" y="68" width="8" height="24" fill="#775338" />
            </g>
          </svg>
        </div>
        <nav className="topnav">
          <div className="brand">
            <img src="/myfarmslogo.png" alt="My Farms logo" className="brand-logo" />
          </div>
          <div className="nav-actions" id="navActions">
            {user ? (
              <div className="nav-user-block">
                <div className="nav-user-actions">
                  <a className="btn-ghost link-btn" href="/about.html">
                    About Us
                  </a>
                  <button className="btn-ghost" onClick={() => setShowProfile(true)}>
                    Edit Profile
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => logoutUser("Logged out")}
                  >
                    Logout
                  </button>
                </div>
                <span className="small muted nav-welcome">Hi {user.name}, thanks for choosing My Farms</span>
              </div>
            ) : (
              <>
                <a className="btn-ghost link-btn" href="/about.html">
                  About Us
                </a>
                <button className="btn-primary" onClick={() => setShowAuth(true)}>
                  Login / Signup
                </button>
              </>
            )}
          </div>
        </nav>

        <div className="hero-content">
          <div className="hero-copy">
            <p className="kicker">Farm To Home</p>
            <h1>Fresh, Natural, and Direct From Farmers</h1>
            <p>
              Fruits, vegetables, dairy, and traditional bull-driven groundnut oil. Quality harvests from our farms,
              delivered to your doorstep.
            </p>
            <div className="hero-points">
              <span>Get delivered within 23 hours</span>
              <span>Chemical-Free Priority</span>
              <span>Traditional Bull-Driven Oil</span>
            </div>
          </div>
          <div className="hero-highlight">
            99.6% Raw&amp;
            <br />
            Unrefined
          </div>
        </div>
      </header>

      <main>
        <section className="showcase-section reveal-on-scroll" aria-label="Featured farm produce carousel">
          <div className="showcase-copy">
            <p className="kicker">Signature Produce</p>
            <h3>Handpicked quality, presented with care</h3>
            <p>
              Where honest soil, patient hands, and everyday nourishment come together.
            </p>
          </div>
          {heroCarouselItems.length ? (
            <div className="hero-showcase">
              <div className="hero-showcase-orbit hero-showcase-orbit-a" />
              <div className="hero-showcase-orbit hero-showcase-orbit-b" />
              <div className="hero-showcase-floor" />
              <div className="hero-showcase-badge">Signature produce</div>
              <div className="hero-carousel">
                {heroCarouselItems.map((item) => (
                  <article
                    key={item.name}
                    className={`hero-produce-card hero-produce-card-${item.offset}`}
                    style={{ "--hero-accent": item.accent }}
                  >
                    <div className="hero-produce-glow" />
                    <img src={item.image} alt={item.name} className="hero-produce-image" />
                    <div className="hero-produce-meta">
                      <strong>{item.name}</strong>
                      <span>{item.tag}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="showcase-empty">
              <strong>No signature products selected yet</strong>
              <p>Admins can mark products as Signature Product in the admin portal to feature them here.</p>
            </div>
          )}
        </section>

        {activePromo ? (
          <section className="promo-showcase" aria-label="Live promotion">
            <div className="promo-orb promo-orb-a" aria-hidden="true" />
            <div className="promo-orb promo-orb-b" aria-hidden="true" />
            <div className="promo-showcase-copy" key={`copy-${activePromo.id}`}>
              <p className="kicker">Live Farm Offer</p>
              <h3>
                Get {activePromo.discountPercent}% off on your orders above ₹{Number(activePromo.minOrderValue || 0).toLocaleString("en-IN")}
              </h3>
              <p>
                Use code <strong>{activePromo.code}</strong> at checkout and enjoy fresh essentials with extra savings.
              </p>
            </div>
            <div className="promo-code-card" key={activePromo.id}>
              <span>Use Code</span>
              <strong>{activePromo.code}</strong>
              <small>Valid until {new Date(activePromo.expiresAt).toLocaleDateString()}</small>
            </div>
            {livePromos.length > 1 ? (
              <div className="promo-dots" aria-label="Promotion slides">
                {livePromos.map((promo, index) => (
                  <button
                    key={promo.id}
                    type="button"
                    className={index === promoCarouselIndex ? "active" : ""}
                    aria-label={`Show promo ${promo.code}`}
                    onClick={() => setPromoCarouselIndex(index)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={`controls ${isFilterCompact ? "compact" : ""}`} id="shopSection">
          <h2>Shop Products</h2>
          <div className="controls-right">
            <input
              id="productSearch"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={animatedSearchHint}
            />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="none">Sort: None</option>
              <option value="priceAsc">Sort: Price Low to High</option>
              <option value="priceDesc">Sort: Price High to Low</option>
              <option value="popularity">Sort: Popularity</option>
            </select>
            <button
              className={`btn-tag ${featuredOnly ? "active" : ""}`}
              onClick={() => setFeaturedOnly((v) => !v)}
            >
              Featured
            </button>
            <div className="filter-wrap" id="categoryFilters">
              {categories.map((c) => (
                <button
                  key={c}
                  className={`btn-tag ${selectedCategory === c ? "active" : ""}`}
                  onClick={() => setSelectedCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="content-grid" ref={productsSectionRef}>
          <div>
            {isInitialLoading ? (
              <div className="products-grid skeleton-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div className="skeleton-card" key={`sk-${i}`} />
                ))}
              </div>
            ) : selectedCategory === "All" && !featuredOnly && featuredProducts.length ? (
              <section className="category-section">
                <h3>Featured Products</h3>
                <div className="products-grid">{featuredProducts.map((p) => renderProductCard(p))}</div>
              </section>
            ) : null}

            {!isInitialLoading ? (
              <>
                <div className="products-grid" id="productsGrid">
                  {filteredProducts.map((p) => renderProductCard(p))}
                </div>
              </>
            ) : null}
            {!isInitialLoading && !filteredProducts.length ? (
              <div className="empty-card">
                <h3>No products found</h3>
                <p>Try clearing filters or search with another keyword.</p>
              </div>
            ) : null}
          </div>

          <aside className="cart-panel">
            <h3 className="cart-title">
              <span>Cart</span>
              {cartItemCount ? <span className="cart-count-badge">{cartItemCount}</span> : null}
            </h3>
            <div id="cartItems">
              {!cart.length ? (
                <p className="muted small">Your cart is empty.</p>
              ) : (
                cart.map((item, idx) => (
                  <div className="cart-item" key={item.key}>
                    <div>
                      <strong>
                        {item.name}
                        {item.variant ? ` (${item.variant})` : ""}
                      </strong>
                      <div className="small muted">
                        Rs.{item.price} x {item.quantity}
                      </div>
                    </div>
                    <div>
                      <button
                        className="btn-ghost small"
                        onClick={() => {
                          setCart((prev) => {
                            const copy = [...prev];
                            copy[idx] = { ...copy[idx], quantity: copy[idx].quantity - 1 };
                            return copy.filter((x) => x.quantity > 0);
                          });
                        }}
                      >
                        -
                      </button>
                      <button
                        className="btn-ghost small"
                        onClick={() => {
                          setCart((prev) => prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c)));
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="total-row">
              <span>Subtotal</span>
              <strong id="cartTotal">Rs.{cartSubtotal.toFixed(2)}</strong>
            </div>
            <button
              className="btn-primary"
              id="checkoutBtn"
              onClick={openCheckoutFlow}
            >
              Checkout
            </button>
            <p className="muted small">Checkout requires login/signup with email.</p>
          </aside>
        </section>

        {cartItemCount ? (
          <div className="mobile-cart-bar">
            <div className="mobile-cart-summary">
              <strong>{cartItemCount} item{cartItemCount > 1 ? "s" : ""}</strong>
              <span>Rs.{cartSubtotal.toFixed(2)}</span>
            </div>
            <button className="btn-primary mobile-cart-btn" type="button" onClick={openCheckoutFlow}>
              {user ? "Checkout" : "Login to Checkout"}
            </button>
          </div>
        ) : null}

        <section className="orders-section reveal-on-scroll">
          <h3>My Orders</h3>
          {!user ? <p className="muted small">Login to view your orders.</p> : null}
          {user ? (
            <button className="btn-ghost" onClick={() => setShowOrderHistory((v) => !v)}>
              {showOrderHistory ? "Hide Order History" : "View Order History"}
            </button>
          ) : null}
          {user && showOrderHistory ? (
            <div id="ordersList" className="orders-list">
              {!orders.length ? (
                <p className="muted small">No orders yet.</p>
              ) : (
                orders.map((o) => (
                  <div className="order-card" key={o.id}>
                    <strong>Order #{o.id.slice(-6).toUpperCase()}</strong>
                    <div className="small muted">{new Date(o.createdAt).toLocaleString()}</div>
                    <div className="small">Status: {statusLabel(o.status)}</div>
                    <div className="small">Payment: {o.paymentMethod}</div>
                    <div className="small">Address: {o.deliveryAddress}</div>
                    {o.promoCode ? <div className="small">Promo: {o.promoCode}</div> : null}
                    <div className="small">
                      <strong>Total: Rs.{Number(o.totalAmount).toFixed(2)}</strong>
                    </div>
                    <div className="order-actions">
                      <button
                        className="btn-ghost small"
                        onClick={() => setExpandedOrders((current) => ({ ...current, [o.id]: !current[o.id] }))}
                      >
                        {expandedOrders[o.id] ? "Hide Items" : "View Items"}
                      </button>
                      <button className="btn-ghost small" onClick={() => reorderOrder(o.id)}>Reorder</button>
                    </div>
                    {expandedOrders[o.id] ? (
                      <div className="order-items-preview">
                        <div className="small order-items-title">Items in this order</div>
                        {(o.items || []).length ? (
                          <div className="order-items-list">
                            {(o.items || []).map((item, index) => (
                              <div className="order-item-row" key={`${o.id}-${item.productId}-${item.variantName || "base"}-${index}`}>
                                <div>
                                  <strong>{item.productName}</strong>
                                  {item.variantName ? <div className="small muted">{item.variantName}</div> : null}
                                </div>
                                <div className="small">Qty: {item.quantity}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="small muted">No item details available for this order.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}
          {user ? (
            <button
              className="btn-ghost"
              onClick={() => {
                const latestOrder = orders && orders.length ? `#${orders[0].id.slice(-6).toUpperCase()}` : "";
                setComplaintForm((s) => ({ ...s, orderNumber: s.orderNumber || latestOrder }));
                setShowComplaint(true);
              }}
            >
              Having issue with your order?
            </button>
          ) : null}
          {user ? (
            <button className="btn-ghost" onClick={() => setShowMyComplaints((v) => !v)}>
              {showMyComplaints ? "Hide My Complaints" : "View My Complaints"}
            </button>
          ) : null}
          {user && showMyComplaints ? (
            <div className="orders-list">
              {!complaints.length ? (
                <p className="muted small">No complaints yet.</p>
              ) : (
                complaints.map((c) => (
                  <div className="order-card" key={c.id}>
                    <strong>Ticket #{c.ticketNumber}</strong>
                    <div className="small muted">{new Date(c.createdAt).toLocaleString()}</div>
                    <div className="small">Order: {c.orderNumber}</div>
                    <div className="small">Status: {c.status}</div>
                    <div className="small">Issue: {c.issue}</div>
                    {c.proofImagePath ? (
                      <div className="small">
                        <a href={resolveAssetUrl(c.proofImagePath)} target="_blank" rel="noreferrer">
                          View Uploaded Proof
                        </a>
                      </div>
                    ) : null}
                    {c.adminReply ? <div className="small"><strong>Support Reply:</strong> {c.adminReply}</div> : null}
                    <div className="small muted">
                      Timeline: {(c.timeline || []).map((t) => `${t.label} (${new Date(t.at).toLocaleString()})`).join(" -> ")}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </section>

      </main>

      <div className="floating-mascot" aria-hidden="true">
        <img className="farmer-mascot-image" src="/resources/farmer-mascot-main.png" alt="" />
      </div>

      {showCheckout ? (
        <>
          <img
            className="checkout-mascot-desktop"
            src="/resources/farmer-mascot-main.png"
            alt=""
            aria-hidden="true"
          />
        </>
      ) : null}

      {showAuth ? (
        <div className="modal">
          <div className="modal-card">
            <button className="close-btn" onClick={() => setShowAuth(false)}>x</button>
            <h3>{authMode === "verify" ? "Verify Email" : authMode === "signup" ? "Create Account" : "Login"}</h3>
            {authMode === "verify" ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (isAuthSubmitting) return;
                  setIsAuthSubmitting(true);
                  try {
                    const code = verificationForm.code.trim();
                    if (!verificationForm.email) {
                      showToast("Please start signup again");
                      return;
                    }
                    if (!/^\d{6}$/.test(code)) {
                      showToast("Enter the 6-digit verification code");
                      return;
                    }

                    const data = await api("/api/auth/verify-email", {
                      method: "POST",
                      body: JSON.stringify({ email: verificationForm.email, code })
                    });

                    setUser(data.user);
                    setShowAuth(false);
                    setVerificationForm({ email: "", code: "", devCode: "" });
                    setAuthForm({ name: "", email: "", password: "" });
                    setShowAuthPassword(false);
                    setAuthMode("login");
                    setProfileForm({
                      name: data.user.name || "",
                      email: data.user.email || "",
                      mobileNumber: data.user.mobileNumber || ""
                    });
                    setCheckout((prev) => ({
                      ...prev,
                      fullName: data.user.name || "",
                      contactNumber: data.user.mobileNumber || ""
                    }));
                    showToast(`Hi ${data.user.name}, your email is verified`);
                  } catch (err) {
                    showToast(err.message);
                  } finally {
                    setIsAuthSubmitting(false);
                  }
                }}
              >
                <p className="auth-note">
                  We sent a 6-digit code to <strong>{verificationForm.email}</strong>. Your account will activate only after verification.
                </p>
                {verificationForm.devCode ? (
                  <p className="auth-dev-note">Development code: <strong>{verificationForm.devCode}</strong></p>
                ) : null}
                <div className="field">
                  <label>Verification Code</label>
                  <input
                    value={verificationForm.code}
                    onChange={(e) => setVerificationForm((s) => ({ ...s, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter 6-digit code"
                    required
                  />
                </div>
                <button className="btn-primary" type="submit" disabled={isAuthSubmitting}>
                  {isAuthSubmitting ? (
                    <span className="btn-loading">
                      <span className="spinner" />
                      Verifying...
                    </span>
                  ) : (
                    "Verify Account"
                  )}
                </button>
                <button
                  className="btn-ghost"
                  type="button"
                  disabled={isAuthSubmitting}
                  onClick={async () => {
                    if (!verificationForm.email) {
                      showToast("Please start signup again");
                      return;
                    }
                    setIsAuthSubmitting(true);
                    try {
                      const data = await api("/api/auth/resend-verification", {
                        method: "POST",
                        body: JSON.stringify({ email: verificationForm.email })
                      });
                      setVerificationForm((s) => ({ ...s, devCode: data.devVerificationCode || s.devCode }));
                      showToast(data.message || "Verification code resent");
                    } catch (err) {
                      showToast(err.message);
                    } finally {
                      setIsAuthSubmitting(false);
                    }
                  }}
                >
                  Resend Code
                </button>
                <button
                  className="btn-link"
                  type="button"
                  disabled={isAuthSubmitting}
                  onClick={() => {
                    setVerificationForm({ email: "", code: "", devCode: "" });
                    setAuthMode("signup");
                  }}
                >
                  Back to signup
                </button>
              </form>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (isAuthSubmitting) return;
                  setIsAuthSubmitting(true);
                  try {
                    const email = authForm.email.trim();
                    if (!isValidEmail(email)) {
                      showToast("Please enter a valid email address");
                      return;
                    }

                    const payload = { email, password: authForm.password };
                    let endpoint = "/api/auth/login";
                    if (authMode === "signup") {
                      if (!isAllowedCustomerEmail(email)) {
                        showToast("Use a Gmail or Yahoo email address");
                        return;
                      }
                      const name = authForm.name.trim();
                      if (!name) {
                        showToast("Name is required for signup");
                        return;
                      }
                      const availability = await api(`/api/auth/check-email?email=${encodeURIComponent(email)}`);
                      if (!availability.available) {
                        if (availability.requiresEmailVerification) {
                          openVerificationStep(email);
                          showToast("This email is pending verification. Please enter the code sent to your inbox.");
                          return;
                        }
                        showToast("Email is already registered. Please login or use another email.");
                        return;
                      }
                      payload.name = name;
                      endpoint = "/api/auth/signup";
                    }

                    const data = await api(endpoint, {
                      method: "POST",
                      body: JSON.stringify(payload)
                    });

                    if (data.requiresEmailVerification) {
                      openVerificationStep(data.email || email, data.devVerificationCode || "");
                      setAuthForm((s) => ({ ...s, password: "" }));
                      showToast(data.message || "Please verify your email to activate your account");
                      return;
                    }

                    setUser(data.user);
                    setShowAuth(false);
                    setAuthForm({ name: "", email: "", password: "" });
                    setShowAuthPassword(false);
                    setAuthMode("login");
                    setProfileForm({
                      name: data.user.name || "",
                      email: data.user.email || "",
                      mobileNumber: data.user.mobileNumber || ""
                    });
                    setCheckout((prev) => ({
                      ...prev,
                      fullName: data.user.name || "",
                      contactNumber: data.user.mobileNumber || ""
                    }));
                    showToast(`Hi ${data.user.name}, thanks for choosing My Farms`);
                  } catch (err) {
                    if (err.data?.requiresEmailVerification && err.data?.email) {
                      openVerificationStep(err.data.email);
                    }
                    showToast(err.message);
                  } finally {
                    setIsAuthSubmitting(false);
                  }
                }}
              >
                {authMode === "signup" ? (
                  <div className="field">
                    <label>Name</label>
                    <input value={authForm.name} onChange={(e) => setAuthForm((s) => ({ ...s, name: e.target.value }))} type="text" />
                  </div>
                ) : null}
                <div className="field">
                  <label>Email</label>
                  <input value={authForm.email} onChange={(e) => setAuthForm((s) => ({ ...s, email: e.target.value }))} type="email" required />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    value={authForm.password}
                    onChange={(e) => setAuthForm((s) => ({ ...s, password: e.target.value }))}
                    type={showAuthPassword ? "text" : "password"}
                    required
                  />
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={showAuthPassword}
                      onChange={(e) => setShowAuthPassword(e.target.checked)}
                    />
                    <span>Show password</span>
                  </label>
                </div>
                <button className="btn-primary" type="submit">
                  {isAuthSubmitting ? (
                    <span className="btn-loading">
                      <span className="spinner" />
                      Please wait...
                    </span>
                  ) : (
                    authMode === "signup" ? "Signup" : "Login"
                  )}
                </button>
                <button
                  className="btn-ghost"
                  type="button"
                  disabled={isAuthSubmitting}
                  onClick={() => {
                    setVerificationForm({ email: "", code: "", devCode: "" });
                    setAuthMode((m) => (m === "login" ? "signup" : "login"));
                  }}
                >
                  {authMode === "signup" ? "Already have account" : "Create account"}
                </button>
                <button
                  className="btn-link"
                  type="button"
                  disabled={isAuthSubmitting}
                  onClick={() => {
                    setShowAuth(false);
                    setShowForgot(true);
                  }}
                >
                  Forgot password?
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {previewProduct ? (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeProductPreview();
            }
          }}
        >
          <div className="preview-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={closeProductPreview}>x</button>
            <div className="preview-drawer-media">
              <span className="preview-drawer-glow" aria-hidden="true" />
              {(() => {
                const previewImage = previewProduct.imagePath
                  ? resolveAssetUrl(previewProduct.imagePath)
                  : getProductImagePath(previewProduct.name, imageFiles);
                return previewImage ? (
                  <img
                    className="preview-drawer-image"
                    src={previewImage}
                    alt={previewProduct.name}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null;
              })()}
            </div>
            <div className="preview-drawer-body">
              <div className="preview-heading-row">
                <div>
                  <span className="badge">{previewProduct.category}</span>
                  <h3>{previewProduct.name}</h3>
                </div>
                {previewProduct.outOfStock ? <span className="stock-badge">Out of Stock</span> : null}
              </div>
              <p className="preview-price">
                Rs.{previewProduct.price}/{previewProduct.unit}
              </p>
              <div className="preview-meta-grid">
                <div className="preview-meta-card">
                  <span>Availability</span>
                  <strong>{previewProduct.outOfStock ? "Currently unavailable" : "Fresh and ready"}</strong>
                </div>
                <div className="preview-meta-card">
                  <span>Status</span>
                  <strong>
                    {previewProduct.outOfStock ? "Out of stock" : "In stock"}
                  </strong>
                </div>
              </div>

              {previewProduct.description ? (
                <p className="preview-copy">{previewProduct.description}</p>
              ) : null}

              {previewProduct.variants.length ? (
                <div className="preview-variants">
                  <p className="preview-section-label">Choose a variant</p>
                  <div className="preview-variant-list">
                    {previewProduct.variants.map((v) => {
                      const unavailable = Number(v.stock || 0) <= 0;
                      const isSelected = previewVariantName === v.name;
                      return (
                        <button
                          key={v.name}
                          type="button"
                          className={`preview-variant-pill ${isSelected ? "active" : ""}`}
                          disabled={unavailable}
                          onClick={() => setPreviewVariantName(v.name)}
                        >
                          <strong>{v.name}</strong>
                          <span>
                            Rs.{v.price}/{previewProduct.unit}
                            {unavailable ? " | Out of stock" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : !previewProduct.description ? (
                <p className="preview-copy">
                  A simple, farm-fresh staple selected to bring dependable quality to everyday kitchens.
                </p>
              ) : null}

              <div className="preview-actions">
                <button className="btn-ghost" type="button" onClick={closeProductPreview}>
                  Continue Browsing
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={
                    previewProduct.outOfStock ||
                    (previewProduct.variants.length
                      ? !previewProduct.variants.find((v) => v.name === previewVariantName && Number(v.stock || 0) > 0)
                      : false)
                  }
                  onClick={() => {
                    const selectedVariant = previewProduct.variants.length
                      ? previewProduct.variants.find((v) => v.name === previewVariantName)
                      : null;
                    addToCart(previewProduct, selectedVariant || null);
                    closeProductPreview();
                  }}
                >
                  {previewProduct.outOfStock ? "Unavailable" : "Add to Cart"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showCheckout ? (
        <div className="modal">
          <div className="modal-card checkout-modal">
            <button className="close-btn" onClick={() => setShowCheckout(false)}>x</button>
            <h3>Checkout</h3>
            <div className="checkout-steps">
              <span className={checkout.fullName && checkout.contactNumber ? "active" : ""}>1. Details</span>
              <span className={checkout.paymentMethod ? "active" : ""}>2. Delivery</span>
              <span className={cart.length ? "active" : ""}>3. Review</span>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isPlacingOrder) return;
                setIsPlacingOrder(true);
                try {
                  const payload = {
                    fullName: checkout.fullName.trim(),
                    contactNumber: checkout.contactNumber.trim(),
                    tipAmount: Number(checkout.tipAmount || 0),
                    promoCode: checkout.promoCode.trim(),
                    paymentMethod: checkout.paymentMethod,
                    address: checkout.address,
                    items: cart.map((c) => ({
                      productId: c.productId,
                      quantity: c.quantity,
                      variant: c.variant
                    }))
                  };

                  if (payload.fullName.length < 2) {
                    showToast("Please enter full name");
                    return;
                  }
                  if (!/^\d{10}$/.test(payload.contactNumber)) {
                    showToast("Please enter a valid 10-digit mobile number");
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

                  setCart([]);
                  setCheckout((prev) => ({ ...prev, tipAmount: "", promoCode: "" }));
                  setPromoPreview({ valid: false, code: "", discountAmount: 0, message: "No promo applied" });
                  setShowCheckout(false);
                  setCelebrationOrderCode(data.orderId.slice(-6).toUpperCase());
                  setShowOrderCelebration(true);
                  setTimeout(() => setShowOrderCelebration(false), 2600);
                  showToast(`Order placed successfully (#${data.orderId.slice(-6).toUpperCase()})`);
                  loadOrders();
                } catch (err) {
                  showToast(err.message);
                } finally {
                  setIsPlacingOrder(false);
                }
              }}
            >
              <div className="field">
                <label>Full Name</label>
                <input
                  value={checkout.fullName}
                  onChange={(e) => setCheckout((s) => ({ ...s, fullName: e.target.value }))}
                  type="text"
                  required
                />
              </div>
              <div className="field">
                <label>Contact Number</label>
                <input
                  value={checkout.contactNumber}
                  onChange={(e) => {
                    const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setCheckout((s) => ({ ...s, contactNumber: digitsOnly }));
                  }}
                  type="tel"
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  required
                  placeholder="Enter 10-digit mobile number"
                />
              </div>
              <div className="field">
                <label>Tip For Delivery (Optional)</label>
                <input
                  value={checkout.tipAmount}
                  onChange={(e) => setCheckout((s) => ({ ...s, tipAmount: e.target.value }))}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 20"
                />
              </div>
              <div className="field">
                <label>Promo Code</label>
                <input
                  value={checkout.promoCode}
                  onChange={(e) => setCheckout((s) => ({ ...s, promoCode: e.target.value }))}
                  type="text"
                  placeholder="Enter promo code"
                />
                <button className="btn-ghost" type="button" onClick={applyPromoCode}>Apply Promo</button>
                <div className="small muted">
                  {promoPreview.message || "Promo will be validated at checkout"}
                </div>
              </div>
              <div className="field">
                <label>Payment Method</label>
                <select
                  value={checkout.paymentMethod}
                  onChange={(e) => setCheckout((s) => ({ ...s, paymentMethod: e.target.value }))}
                  required
                >
                  <option value="COD">Cash On Delivery</option>
                  <option value="PICKUP">Store Pickup</option>
                </select>
              </div>
              {checkout.paymentMethod !== "PICKUP" ? (
                <div className="field">
                  <label>Delivery Address</label>
                  <textarea
                    value={checkout.address}
                    onChange={(e) => setCheckout((s) => ({ ...s, address: e.target.value }))}
                    rows="3"
                    placeholder="House no, street, area, city, pincode"
                  />
                </div>
              ) : null}
              <div className="card-summary">
                <div className="total-row">
                  <span>Subtotal</span>
                  <strong>Rs.{cartSubtotal.toFixed(2)}</strong>
                </div>
                <div className="total-row">
                  <span>Discount</span>
                  <strong>-Rs.{discountAmount.toFixed(2)}</strong>
                </div>
                <div className="total-row">
                  <span>Tax (5%)</span>
                  <strong>Rs.{taxAmount.toFixed(2)}</strong>
                </div>
                <div className="total-row">
                  <span>Tip</span>
                  <strong>Rs.{(Number.isFinite(parsedTip) ? parsedTip : 0).toFixed(2)}</strong>
                </div>
                <div className="total-row">
                  <span>Grand Total</span>
                  <strong>Rs.{checkoutTotal.toFixed(2)}</strong>
                </div>
              </div>
              <button className="btn-primary" type="submit" disabled={isPlacingOrder}>
                {isPlacingOrder ? (
                  <span className="btn-loading">
                    <span className="spinner" />
                    Placing Order...
                  </span>
                ) : (
                  "Place Order"
                )}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {showOrderCelebration ? (
        <div className="celebration-overlay" aria-live="polite">
          <div className="celebration-card">
            <div className="celebration-burst" aria-hidden="true">
              <span className="celebration-piece c1" />
              <span className="celebration-piece c2" />
              <span className="celebration-piece c3" />
              <span className="celebration-piece c4" />
              <span className="celebration-piece c5" />
              <span className="celebration-piece c6" />
              <span className="celebration-piece c7" />
              <span className="celebration-piece c8" />
            </div>
            <div className="celebration-icon">Tada!</div>
            <h3>Order Placed Successfully</h3>
            <p>Your fresh products are confirmed and being prepared.</p>
            <strong>Order #{celebrationOrderCode}</strong>
          </div>
        </div>
      ) : null}

      {showProfile && user ? (
        <div className="modal">
          <div className="modal-card">
            <button className="close-btn" onClick={() => setShowProfile(false)}>x</button>
            <h3>Edit Profile</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isProfileSubmitting) return;
                setIsProfileSubmitting(true);
                try {
                  const payload = {
                    name: profileForm.name.trim(),
                    email: profileForm.email.trim(),
                    mobileNumber: profileForm.mobileNumber.trim()
                  };

                  if (!payload.name || payload.name.length < 2) {
                    showToast("Please enter valid name");
                    return;
                  }
                  if (!isValidEmail(payload.email)) {
                    showToast("Please enter a valid email address");
                    return;
                  }
                  if (!isAllowedCustomerEmail(payload.email)) {
                    showToast("Use a Gmail or Yahoo email address");
                    return;
                  }
                  if (payload.mobileNumber && !/^\d{10}$/.test(payload.mobileNumber)) {
                    showToast("Please enter a valid 10-digit mobile number");
                    return;
                  }

                  const data = await api("/api/auth/profile", {
                    method: "PATCH",
                    body: JSON.stringify(payload)
                  });
                  setUser(data.user);
                  setShowProfile(false);
                  showToast("Profile updated");
                } catch (err) {
                  showToast(err.message);
                } finally {
                  setIsProfileSubmitting(false);
                }
              }}
            >
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm((s) => ({ ...s, name: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm((s) => ({ ...s, email: e.target.value }))}
                  disabled
                  required
                />
                <p className="field-help">Email is locked to your verified account so order updates always reach the right inbox.</p>
              </div>
              <div className="field">
                <label>Mobile Number</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  value={profileForm.mobileNumber}
                  onChange={(e) => setProfileForm((s) => ({ ...s, mobileNumber: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                  placeholder="10-digit mobile number"
                />
              </div>
              <button className="btn-primary" type="submit" disabled={isProfileSubmitting}>
                {isProfileSubmitting ? (
                  <span className="btn-loading">
                    <span className="spinner" />
                    Saving...
                  </span>
                ) : (
                  "Save Profile"
                )}
              </button>
              <button
                className="btn-danger"
                type="button"
                disabled={isProfileSubmitting || isDeletingAccount}
                onClick={async () => {
                  const confirmed = window.confirm(
                    "Delete your account permanently? This will remove your profile and order history."
                  );
                  if (!confirmed) return;

                  setIsDeletingAccount(true);
                  try {
                    await api("/api/auth/account", { method: "DELETE" });
                    setShowProfile(false);
                    setUser(null);
                    setOrders([]);
                    setComplaints([]);
                    setCart([]);
                    setProfileForm({ name: "", email: "", mobileNumber: "" });
                    setCheckout((prev) => ({ ...prev, fullName: "", contactNumber: "" }));
                    showToast("Your account and order history were deleted");
                  } catch (err) {
                    showToast(err.message);
                  } finally {
                    setIsDeletingAccount(false);
                  }
                }}
              >
                {isDeletingAccount ? (
                  <span className="btn-loading">
                    <span className="spinner" />
                    Deleting...
                  </span>
                ) : (
                  "Delete Account"
                )}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {showForgot ? (
        <div className="modal">
          <div className="modal-card">
            <button className="close-btn" onClick={() => setShowForgot(false)}>x</button>
            <h3>Forgot Password</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isForgotSubmitting) return;
                setIsForgotSubmitting(true);
                try {
                  const email = forgotEmail.trim();
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
                  setShowForgot(false);
                  setForgotEmail("");
                  showToast(data.message || "Password reset process started");
                  window.location.href = targetUrl;
                } catch (err) {
                  showToast(err.message);
                } finally {
                  setIsForgotSubmitting(false);
                }
              }}
            >
              <div className="field">
                <label>Email</label>
                <input value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} type="email" required />
              </div>
              <button className="btn-primary" type="submit" disabled={isForgotSubmitting}>
                {isForgotSubmitting ? (
                  <span className="btn-loading">
                    <span className="spinner" />
                    Sending...
                  </span>
                ) : (
                  "Send Reset Link"
                )}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {showComplaint ? (
        <div className="modal">
          <div className="modal-card">
            <button className="close-btn" onClick={() => setShowComplaint(false)}>x</button>
            <h3>Report Order Issue</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isComplaintSubmitting) return;
                setIsComplaintSubmitting(true);
                try {
                  const orderNumber = complaintForm.orderNumber.trim();
                  const issue = complaintForm.issue.trim();

                  if (!orderNumber || orderNumber.replace(/^#/, "").length < 4) {
                    showToast("Please enter valid order number");
                    return;
                  }
                  if (issue.length < 10) {
                    showToast("Please describe your issue in at least 10 characters");
                    return;
                  }

                  await api("/api/complaints", {
                    method: "POST",
                    body: (() => {
                      const fd = new FormData();
                      fd.append("orderNumber", orderNumber);
                      fd.append("issue", issue);
                      if (complaintForm.proofImage) fd.append("proofImage", complaintForm.proofImage);
                      return fd;
                    })()
                  });
                  setShowComplaint(false);
                  setComplaintForm({ orderNumber: "", issue: "", proofImage: null });
                  await loadComplaints();
                  showToast("Issue reported to customer representative. We will respond very shortly.");
                } catch (err) {
                  showToast(err.message);
                } finally {
                  setIsComplaintSubmitting(false);
                }
              }}
            >
              <div className="field">
                <label>Order Number</label>
                <input
                  type="text"
                  value={complaintForm.orderNumber}
                  onChange={(e) => setComplaintForm((s) => ({ ...s, orderNumber: e.target.value }))}
                  placeholder="Example: #A1B2C3 or last 6 chars"
                  required
                />
              </div>
              <div className="field">
                <label>What is the issue?</label>
                <textarea
                  rows="4"
                  value={complaintForm.issue}
                  onChange={(e) => setComplaintForm((s) => ({ ...s, issue: e.target.value }))}
                  placeholder="Describe your issue..."
                  required
                />
              </div>
              <div className="field">
                <label>Upload Proof Photo (Optional)</label>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                    setComplaintForm((s) => ({ ...s, proofImage: file }));
                  }}
                />
              </div>
              <button className="btn-primary" type="submit" disabled={isComplaintSubmitting}>
                {isComplaintSubmitting ? (
                  <span className="btn-loading">
                    <span className="spinner" />
                    Submitting...
                  </span>
                ) : (
                  "Submit Complaint"
                )}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div className={`toast ${toast ? "" : "hidden"}`}>{toast}</div>
    </>
  );
}
