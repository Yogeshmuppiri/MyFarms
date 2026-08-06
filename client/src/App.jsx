import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { SpeechRecognition as NativeSpeechRecognition } from "@capacitor-community/speech-recognition";
import {
  api,
  getProductImagePath,
  getShowcaseAccent,
  getSpeechProductText,
  isAllowedCustomerEmail,
  isDeliveredStatus,
  isValidEmail,
  normalizeToken,
  parseSpokenNumber,
  resolveAssetUrl,
  resolveSiteUrl,
  sanitizePromoCode,
  scoreSpeechProductMatch,
  statusLabel,
  tokenizeSpeechProduct
} from "./utils";

const PRODUCT_SPEECH_ALIASES = [
  { terms: ["milk", "fresh milk"], names: ["Fresh Milk"] },
  { terms: ["egg", "eggs"], names: ["Eggs"] },
  { terms: ["chicken"], names: ["Broiler Chicken", "Natu Kodi Chicken"] },
  { terms: ["broiler", "broiler chicken"], names: ["Broiler Chicken"] },
  { terms: ["natu kodi", "natukodi", "country chicken"], names: ["Natu Kodi Chicken"] },
  { terms: ["tomato", "tomatoes"], names: ["Tomatoes"] },
  { terms: ["curd", "yoghurt", "yogurt"], names: ["Yogurt"] },
  { terms: ["paneer", "panner"], names: ["Paneer"] },
  { terms: ["groundnut oil", "oil"], names: ["Organic Groundnut Oil (Bull Driven)"] },
  { terms: ["bendi", "okra"], names: ["Okra/Bendi"] },
  { terms: ["brinjal", "eggplant", "long eggplant"], names: ["Brinjal", "Long Egg Plant"] }
];

const TAX_RATE = 0.05;
const CUSTOMER_IDLE_MS = 30 * 60 * 1000;
const LAST_ACTIVITY_KEY = "myfarms_last_activity_at";
const WALLET_COINS_PER_RUPEE = 50;
const GESTURE_DWELL_MS = 2600;
const DEFAULT_SEARCH_HINTS = [
  "Search for milk",
  "Search for eggs",
  "Search for chicken"
];
const IS_NATIVE_APP = Capacitor.isNativePlatform();

export default function App() {
  const logoUrl = resolveSiteUrl("/resources/myfarmslogo.png");
  const mascotUrl = resolveSiteUrl("/resources/farmer-mascot-main.png");
  const aboutUrl = resolveSiteUrl("/about.html");
  const termsUrl = resolveSiteUrl("/terms-and-conditions.html");
  const menuIconUrl = (name) => resolveSiteUrl(`/resources/${name}`);

  const [products, setProducts] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [livePromos, setLivePromos] = useState([]);
  const [wallet, setWallet] = useState({ balance: 0, transactions: [], rewardRate: null });
  const [cart, setCart] = useState([]);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortBy, setSortBy] = useState("none");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [isVoiceCommandActive, setIsVoiceCommandActive] = useState(false);
  const [animatedSearchHint, setAnimatedSearchHint] = useState(DEFAULT_SEARCH_HINTS[0]);
  const [orders, setOrders] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [toast, setToast] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [promoPreview, setPromoPreview] = useState({ valid: false, code: "", discountAmount: 0, message: "" });
  const [loadedProductImages, setLoadedProductImages] = useState(() => new Set());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFilterCompact, setIsFilterCompact] = useState(false);

  const [showAuth, setShowAuth] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(1);
  const [showForgot, setShowForgot] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showFreshnessChecker, setShowFreshnessChecker] = useState(false);
  const [showFarmAssistant, setShowFarmAssistant] = useState(false);
  const [showMainMenu, setShowMainMenu] = useState(false);
  const [showAppProfileMenu, setShowAppProfileMenu] = useState(false);
  const [showMenuOrders, setShowMenuOrders] = useState(false);
  const [accountPanel, setAccountPanel] = useState(null);
  const [accountPanelReturnToProfile, setAccountPanelReturnToProfile] = useState(false);
  const [profileToolReturnToProfile, setProfileToolReturnToProfile] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);
  const [managingOrder, setManagingOrder] = useState(null);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [heroCarouselIndex, setHeroCarouselIndex] = useState(0);
  const [promoCarouselIndex, setPromoCarouselIndex] = useState(0);
  const [showOrderCelebration, setShowOrderCelebration] = useState(false);
  const [celebrationOrderCode, setCelebrationOrderCode] = useState("");
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authTermsAccepted, setAuthTermsAccepted] = useState(false);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isComplaintSubmitting, setIsComplaintSubmitting] = useState(false);
  const [freshnessCameraOn, setFreshnessCameraOn] = useState(false);
  const [isFreshnessAnalyzing, setIsFreshnessAnalyzing] = useState(false);
  const [freshnessResult, setFreshnessResult] = useState(null);
  const [assistantMessage, setAssistantMessage] = useState("Try saying: add milk, show tomatoes, checkout, or show my orders.");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [gestureCameraOn, setGestureCameraOn] = useState(false);
  const [isGestureLoading, setIsGestureLoading] = useState(false);
  const [gestureStatus, setGestureStatus] = useState("Open gesture mode and hold a gesture steady for a moment.");
  const [gestureDetected, setGestureDetected] = useState({ label: "Idle", confidence: 0, action: "Ready" });
  const [gestureSelectedProductId, setGestureSelectedProductId] = useState("");
  const [gestureCursor, setGestureCursor] = useState({ active: false, x: 0, y: 0, progress: 0, label: "" });
  const [pendingAssistantOrderConfirmation, setPendingAssistantOrderConfirmation] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const voiceRecognitionRef = useRef(null);
  const voiceShouldListenRef = useRef(false);
  const voiceRestartTimerRef = useRef(null);
  const nativeVoiceActiveRef = useRef(false);
  const nativeVoiceSessionRef = useRef(0);
  const nativeVoiceRestartTimerRef = useRef(null);
  const productsSectionRef = useRef(null);
  const cartPanelRef = useRef(null);
  const cartRef = useRef([]);
  const checkoutRef = useRef(null);
  const showCheckoutRef = useRef(false);
  const checkoutStepRef = useRef(1);
  const isPlacingOrderRef = useRef(false);
  const pendingAssistantOrderConfirmationRef = useRef(false);
  const freshnessVideoRef = useRef(null);
  const freshnessCanvasRef = useRef(null);
  const freshnessStreamRef = useRef(null);
  const gestureVideoRef = useRef(null);
  const gestureStreamRef = useRef(null);
  const gestureRecognizerRef = useRef(null);
  const gestureRafRef = useRef(null);
  const gestureLastActionRef = useRef({ name: "", at: 0 });
  const gestureStableRef = useRef({ name: "", count: 0, score: 0 });
  const gestureLastVideoTimeRef = useRef(-1);
  const gestureSelectedProductIdRef = useRef("");
  const gestureCursorRef = useRef({ x: 0, y: 0, targetId: "", startedAt: 0, lastUpdateAt: 0, cooldownUntil: 0 });
  const productsRef = useRef([]);
  const categoriesRef = useRef([]);
  const filteredProductsRef = useRef([]);
  const selectedCategoryRef = useRef("All");
  const cartItemCountRef = useRef(0);
  const userRef = useRef(null);

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
    useWalletCoins: false,
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
        id: p.id,
        name: p.name,
        tag: p.featured ? "Customer favorite" : (p.category || "Farm fresh"),
        image: p.imagePath ? resolveAssetUrl(p.imagePath) : getProductImagePath(p.name, imageFiles),
        accent: getShowcaseAccent(p.category),
        product: p
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
  const trackedOrders = useMemo(() => (orders || []).filter((order) => order.canTrack).slice(0, 4), [orders]);
  const activeNavOrderCount = useMemo(
    () => (orders || []).filter((order) => {
      const status = String(order.status || "").toUpperCase();
      return order.canTrack && status !== "CANCELED" && !isDeliveredStatus(status);
    }).length,
    [orders]
  );
  const productImageUrls = useMemo(() => {
    const urls = new Set();
    for (const product of products) {
      const imageUrl = product.imagePath ? resolveAssetUrl(product.imagePath) : getProductImagePath(product.name, imageFiles);
      if (imageUrl) urls.add(imageUrl);
    }
    return [...urls];
  }, [products, imageFiles]);

  const activePromo = livePromos.length ? livePromos[promoCarouselIndex % livePromos.length] : null;

  const cartSubtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const cartItemCount = useMemo(() => cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0), [cart]);
  const parsedTip = Number(checkout.tipAmount || 0);
  const discountAmount = Number(promoPreview.discountAmount || 0);
  const taxableAmount = cartSubtotal - discountAmount;
  const taxAmount = taxableAmount * TAX_RATE;
  const checkoutTotalBeforeWallet = taxableAmount + taxAmount + (Number.isFinite(parsedTip) ? parsedTip : 0);
  const walletBalance = Math.max(0, Math.floor(Number(wallet.balance || user?.walletCoins || 0)));
  const walletDiscountCapacity = Math.floor(walletBalance / WALLET_COINS_PER_RUPEE);
  const walletRedeemEstimate = checkout.useWalletCoins ? Math.min(walletDiscountCapacity, Math.floor(checkoutTotalBeforeWallet)) : 0;
  const walletCoinsUsedEstimate = walletRedeemEstimate * WALLET_COINS_PER_RUPEE;
  const checkoutTotal = Math.max(0, checkoutTotalBeforeWallet - walletRedeemEstimate);
  const coinsEarnEstimate = Math.floor(Math.max(0, taxableAmount - walletRedeemEstimate) / WALLET_COINS_PER_RUPEE);
  const farmAssistantActive = isVoiceCommandActive || isVoiceListening || gestureCameraOn || isGestureLoading;

  useEffect(() => {
    productsRef.current = products;
    categoriesRef.current = categories;
    filteredProductsRef.current = filteredProducts;
    selectedCategoryRef.current = selectedCategory;
    cartItemCountRef.current = cartItemCount;
    userRef.current = user;
    cartRef.current = cart;
    checkoutRef.current = checkout;
    showCheckoutRef.current = showCheckout;
    checkoutStepRef.current = checkoutStep;
    isPlacingOrderRef.current = isPlacingOrder;
    pendingAssistantOrderConfirmationRef.current = pendingAssistantOrderConfirmation;
  }, [products, categories, filteredProducts, selectedCategory, cartItemCount, user, cart, checkout, showCheckout, checkoutStep, isPlacingOrder, pendingAssistantOrderConfirmation]);

  useEffect(() => {
    if (!productImageUrls.length) return undefined;
    const preloaded = productImageUrls.map((url) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        setLoadedProductImages((current) => {
          if (current.has(url)) return current;
          const next = new Set(current);
          next.add(url);
          return next;
        });
      };
      img.src = url;
      return img;
    });
    return () => {
      preloaded.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [productImageUrls]);

  useEffect(() => {
    if (
      gestureSelectedProductId &&
      !filteredProducts.some((product) => String(product.id) === String(gestureSelectedProductId) && !product.outOfStock)
    ) {
      gestureSelectedProductIdRef.current = "";
      setGestureSelectedProductId("");
    }
  }, [filteredProducts, gestureSelectedProductId]);

  const hasOpenOverlay = Boolean(
    showAuth ||
    showTerms ||
    showForgot ||
    showProfile ||
    showWallet ||
    showFreshnessChecker ||
    showFarmAssistant ||
    showAppProfileMenu ||
    accountPanel ||
    showComplaint ||
    managingOrder ||
    previewProduct ||
    showCheckout
  );

  useEffect(() => {
    if (!hasOpenOverlay) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [hasOpenOverlay]);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }

  function showCheckoutNotice(message) {
    setCheckoutNotice(message);
  }

  function findProductBySpeech(text) {
    const queryText = getSpeechProductText(text);
    const queryTokens = tokenizeSpeechProduct(text);
    const queryToken = normalizeToken(queryText || text);
    if (!queryToken) return null;

    for (const alias of PRODUCT_SPEECH_ALIASES) {
      const matchedAlias = alias.terms.some((term) => {
        const termToken = normalizeToken(term);
        return queryToken === termToken || queryToken.includes(termToken) || termToken.includes(queryToken);
      });
      if (!matchedAlias) continue;

      const product = alias.names
        .map((name) => productsRef.current.find((p) => normalizeToken(p.name) === normalizeToken(name)))
        .find(Boolean);
      if (product) return product;
    }

    let bestProduct = null;
    let bestScore = 0;
    for (const product of productsRef.current) {
      const score = scoreSpeechProductMatch(product, queryTokens, queryToken);
      if (score > bestScore) {
        bestProduct = product;
        bestScore = score;
      }
    }

    return bestScore >= 40 ? bestProduct : null;
  }

  function findCartItemBySpeech(text) {
    const queryText = getSpeechProductText(text);
    const queryTokens = tokenizeSpeechProduct(text);
    const queryToken = normalizeToken(queryText || text);
    if (!queryToken) return null;

    const matchedProduct = findProductBySpeech(text);
    const matchedProductToken = normalizeToken(matchedProduct?.name);
    let bestItem = null;
    let bestScore = 0;

    for (const item of cartRef.current || []) {
      const itemProduct = matchedProductToken && normalizeToken(item.name) === matchedProductToken ? { name: item.name } : item;
      const score = matchedProductToken && normalizeToken(item.name) === matchedProductToken
        ? 120
        : scoreSpeechProductMatch(itemProduct, queryTokens, queryToken);
      if (score > bestScore) {
        bestItem = item;
        bestScore = score;
      }
    }

    return bestScore >= 40 ? bestItem : null;
  }

  function removeCartItemBySpeech(text) {
    const item = findCartItemBySpeech(text);
    if (!item) {
      const productText = getSpeechProductText(text) || text;
      setAssistantMessage(`I could not find ${productText} in cart`);
      showToast(`Not in cart: ${productText}`);
      return true;
    }

    setCart((current) =>
      current
        .map((cartItem) => (cartItem.key === item.key ? { ...cartItem, quantity: cartItem.quantity - 1 } : cartItem))
        .filter((cartItem) => cartItem.quantity > 0)
    );
    setAssistantMessage(`Removed ${item.name} from cart`);
    showToast(`Removed ${item.name}`);
    return true;
  }

  function cycleCategory() {
    const currentCategories = categoriesRef.current;
    if (!currentCategories.length) return;
    const currentIndex = currentCategories.indexOf(selectedCategoryRef.current);
    const nextCategory = currentCategories[(currentIndex + 1) % currentCategories.length] || "All";
    setSelectedCategory(nextCategory);
    setAssistantMessage(`Showing ${nextCategory}`);
    showToast(`Showing ${nextCategory}`);
  }

  function scrollPageByDirection(direction) {
    const amount = Math.max(360, Math.floor(window.innerHeight * 0.72));
    window.scrollBy({ top: direction === "up" ? -amount : amount, behavior: "smooth" });
    setAssistantMessage(direction === "up" ? "Scrolling up" : "Scrolling down");
  }

  async function openOrdersByVoice({ statusOnly = false } = {}) {
    if (!userRef.current) {
      setShowAuth(true);
      setAssistantMessage("Please login to view orders");
      return true;
    }

    openAccountPanel("orders");
    const latestOrders = await loadOrders();
    const latestOrder = (latestOrders || orders).find(Boolean);

    if (statusOnly && latestOrder) {
      const orderCode = latestOrder.id ? `#${latestOrder.id.slice(-6).toUpperCase()}` : "";
      const message = `Latest order ${orderCode} is ${statusLabel(latestOrder.status)}`;
      setAssistantMessage(message);
      showToast(message);
      return true;
    }

    if (statusOnly) {
      setAssistantMessage("No orders found yet");
      showToast("No orders found yet");
      return true;
    }

    setAssistantMessage("Opening your orders");
    return true;
  }

  async function openDashboardByVoice() {
    if (!userRef.current) {
      setShowAuth(true);
      setAssistantMessage("Please login to open My Farms Dashboard");
      return true;
    }

    setShowMainMenu(true);
    setShowMenuOrders(false);
    const [latestOrders, latestComplaints, latestWallet] = await Promise.all([
      loadOrders(),
      loadComplaints(),
      loadWallet()
    ]);
    const coins = Number(latestWallet?.balance ?? walletBalance);
    const message = `Dashboard ready: ${Math.max(0, Math.floor(coins))} wallet coins, ${latestOrders.length} orders, ${latestComplaints.length} complaints`;
    setAssistantMessage(message);
    showToast("My Farms Dashboard opened");
    return true;
  }

  async function openWalletByVoice() {
    if (!userRef.current) {
      setShowAuth(true);
      setAssistantMessage("Please login to view wallet coins");
      return true;
    }

    setShowMainMenu(false);
    setShowWallet(true);
    const latestWallet = await loadWallet();
    const coins = Math.max(0, Math.floor(Number(latestWallet?.balance ?? walletBalance)));
    setAssistantMessage(`You have ${coins} wallet coins`);
    return true;
  }

  async function confirmAssistantOrderPlacement() {
    pendingAssistantOrderConfirmationRef.current = false;
    setPendingAssistantOrderConfirmation(false);
    setAssistantMessage("Placing your order");
    await placeOrder();
    return true;
  }

  function cancelAssistantOrderPlacement() {
    pendingAssistantOrderConfirmationRef.current = false;
    setPendingAssistantOrderConfirmation(false);
    setAssistantMessage("Order placement canceled");
    showToast("Order placement canceled");
    return true;
  }

  function openProfileByVoice() {
    if (!userRef.current) {
      setShowAuth(true);
      setAssistantMessage("Please login to edit profile");
      return true;
    }

    setShowMainMenu(false);
    setShowProfile(true);
    setAssistantMessage("Opening your profile");
    return true;
  }

  function fillCheckoutByVoice(normalized, phrase) {
    if (!showCheckoutRef.current) return false;

    if (/\b(wallet|coins?)\b/.test(normalized)) {
      if (/\b(remove|disable|off|don't|dont|no|stop|uncheck)\b/.test(normalized)) {
        setCheckout((current) => ({ ...current, useWalletCoins: false }));
        setAssistantMessage("Wallet coins removed from checkout");
        showToast("Wallet coins removed");
        return true;
      }
      if (/\b(use|apply|add|enable|on|check)\b/.test(normalized)) {
        if (!walletBalance) {
          setAssistantMessage("No wallet coins available to use");
          showToast("No wallet coins available");
          return true;
        }
        setCheckout((current) => ({ ...current, useWalletCoins: true }));
        setAssistantMessage("Wallet coins applied to checkout");
        showToast("Wallet coins applied");
        return true;
      }
    }

    if (/\b(address|delivery address)\b/.test(normalized)) {
      const address = phrase
        .replace(/\b(set|add|use|my|delivery|address|is|as|to|please)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!address) {
        setAssistantMessage("Please say the delivery address after the word address");
        return true;
      }
      setCheckout((current) => ({ ...current, paymentMethod: current.paymentMethod === "PICKUP" ? "COD" : current.paymentMethod, address }));
      setAssistantMessage("Delivery address added");
      showToast("Delivery address added");
      return true;
    }

    if (/\b(tip|delivery tip)\b/.test(normalized)) {
      const amount = parseSpokenNumber(phrase);
      if (amount === null || amount < 0 || amount > 5000) {
        setAssistantMessage("Tip should be between 0 and 5000");
        showToast("Tip should be between 0 and 5000");
        return true;
      }
      setCheckout((current) => ({ ...current, tipAmount: String(amount) }));
      setAssistantMessage(`Tip set to Rs.${amount}`);
      showToast(`Tip set to Rs.${amount}`);
      return true;
    }

    if (/\b(promo|coupon|code)\b/.test(normalized)) {
      const rawCode = phrase
        .replace(/\b(set|add|apply|use|my|promo|coupon|code|is|as|to|please)\b/gi, " ")
        .replace(/\s+/g, "")
        .trim();
      const promoCode = sanitizePromoCode(rawCode);
      if (!promoCode) {
        setAssistantMessage("Please say the promo code after promo code");
        return true;
      }
      setCheckout((current) => ({ ...current, promoCode }));
      setAssistantMessage(`Promo code set to ${promoCode}`);
      showToast(`Promo code set to ${promoCode}`);
      return true;
    }

    if (/\b(payment|pay|pickup|delivery|cash)\b/.test(normalized)) {
      if (/\b(pickup|store pickup|collect)\b/.test(normalized)) {
        setCheckout((current) => ({ ...current, paymentMethod: "PICKUP" }));
        setAssistantMessage("Payment method set to Store Pickup");
        showToast("Payment method set to Store Pickup");
        return true;
      }
      if (/\b(cash|cod|cash on delivery|delivery)\b/.test(normalized)) {
        setCheckout((current) => ({ ...current, paymentMethod: "COD" }));
        setAssistantMessage("Payment method set to Cash On Delivery");
        showToast("Payment method set to Cash On Delivery");
        return true;
      }
    }

    return false;
  }

  async function runShoppingCommand(transcript) {
    const phrase = String(transcript || "").trim();
    const normalized = phrase.toLowerCase();
    if (!phrase) return false;

    setAssistantTranscript(phrase);
    const wantsAdd = /\b(add|buy|get|put)\b/i.test(normalized);
    const wantsRemove = /\b(remove|delete|take out|drop)\b/i.test(normalized);
    const wantsCheckout = /\b(checkout|check\s+out)\b/.test(normalized);
    const wantsPlaceOrder = /\b(place|submit|confirm)\b.*\b(order|purchase)\b/.test(normalized);

    if (pendingAssistantOrderConfirmationRef.current) {
      if (/^\s*(yes|yeah|yep|ok|okay|sure)\s*$/i.test(phrase) || /\b(yes place|yes submit|yes confirm)\b/.test(normalized)) {
        return confirmAssistantOrderPlacement();
      }
      if (/\b(no|cancel|stop|wait)\b/.test(normalized)) {
        return cancelAssistantOrderPlacement();
      }
      setAssistantMessage("Say yes to place order, or no to cancel");
      return true;
    }

    if (wantsCheckout) {
      setAssistantMessage("Opening checkout");
      openCheckoutFlow();
      return true;
    }

    if ((showCheckoutRef.current || showCheckout) && wantsPlaceOrder) {
      pendingAssistantOrderConfirmationRef.current = true;
      setPendingAssistantOrderConfirmation(true);
      setAssistantMessage("Say yes to place order, or no to cancel");
      showToast("Confirm by saying yes or no");
      return true;
    }

    if (fillCheckoutByVoice(normalized, phrase)) {
      return true;
    }

    if (/\b(scroll|go|move)\b/.test(normalized) && /\bdown|below|next\b/.test(normalized)) {
      scrollPageByDirection("down");
      return true;
    }

    if (/\b(scroll|go|move)\b/.test(normalized) && /\bup|above|back\b/.test(normalized)) {
      scrollPageByDirection("up");
      return true;
    }

    if (/\b(top|home)\b/.test(normalized) && /\b(go|scroll|move|back)\b/.test(normalized)) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setAssistantMessage("Going to top");
      return true;
    }

    if (/\b(products?|shop)\b/.test(normalized) && /\b(go|scroll|show|open)\b/.test(normalized)) {
      productsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setAssistantMessage("Showing products");
      return true;
    }

    if (/\bcart\b/.test(normalized) && /\b(go|scroll|show|open)\b/.test(normalized) && !wantsAdd) {
      cartPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setAssistantMessage("Showing cart");
      return true;
    }

    if (normalized.includes("cart") && !wantsAdd) {
      const count = cartItemCountRef.current;
      setAssistantMessage(`${count} item${count === 1 ? "" : "s"} in cart`);
      showToast(`${count} item${count === 1 ? "" : "s"} in cart`);
      return true;
    }

    if (/\borders?\b/.test(normalized) && !wantsAdd) {
      const statusOnly = /\b(track|status|latest|last)\b/.test(normalized);
      return openOrdersByVoice({ statusOnly });
    }

    if (/\b(dashboard|my farms dashboard|myfarms dashboard|account dashboard)\b/.test(normalized) && !wantsAdd) {
      return openDashboardByVoice();
    }

    if (/\b(wallet|coins?)\b/.test(normalized) && !wantsAdd) {
      return openWalletByVoice();
    }

    if (/\b(profile|account)\b/.test(normalized) && /\b(open|show|view|edit|my)\b/.test(normalized) && !wantsAdd) {
      return openProfileByVoice();
    }

    if (/\b(complaints?|tickets?)\b/.test(normalized) && !wantsAdd) {
      if (!userRef.current) {
        setShowAuth(true);
        setAssistantMessage("Please login to view complaints");
      } else {
        openAccountPanel("complaints");
        setAssistantMessage("Opening your complaints");
      }
      return true;
    }

    if (/\b(report|issue|problem)\b/.test(normalized) && /\border\b/.test(normalized) && !wantsAdd) {
      if (!userRef.current) {
        setShowAuth(true);
        setAssistantMessage("Please login to report an order issue");
      } else {
        openComplaintFlow();
        setAssistantMessage("Opening order issue form");
      }
      return true;
    }

    const asksAboutMyFarms =
      /\babout\s+(us|my\s*farms?|myfarms)\b/.test(normalized) ||
      /\b(open|show|view|go to|tell me about|what is)\b.*\b(my\s*farms?|myfarms)\b/.test(normalized) ||
      /\b(my\s*farms?|myfarms)\b.*\b(about|info|information)\b/.test(normalized);
    if (asksAboutMyFarms && !wantsAdd) {
      setAssistantMessage("Opening About Us");
      window.location.assign(aboutUrl);
      return true;
    }

    if (normalized.includes("next category") || normalized.includes("change category")) {
      cycleCategory();
      return true;
    }

    const category = categoriesRef.current.find((c) => c !== "All" && normalized.includes(c.toLowerCase()));
    if (category && (normalized.includes("show") || normalized.includes("category") || normalized.includes("open"))) {
      setSelectedCategory(category);
      setAssistantMessage(`Showing ${category}`);
      productsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    }

    const product = findProductBySpeech(phrase);
    if (product && wantsAdd) {
      addProductDirectly(product);
      setAssistantMessage(`Added ${product.name} to cart`);
      return true;
    }

    if (wantsRemove) {
      return removeCartItemBySpeech(phrase);
    }

    if (wantsAdd) {
      const productText = getSpeechProductText(phrase) || phrase;
      setSearchQuery(productText);
      setSelectedCategory("All");
      productsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setAssistantMessage(`I could not find ${productText}. Showing close matches.`);
      showToast(`Showing matches for ${productText}`);
      return true;
    }

    const cleanedSearch = phrase
      .replace(/\b(show|search|find|for|products?|product|items?|item)\b/gi, "")
      .trim();
    const query = cleanedSearch || phrase;
    setSearchQuery(query);
    setSelectedCategory("All");
    productsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setAssistantMessage(`Searching for ${query}`);
    showToast(`Searching: ${query}`);
    return true;
  }

  function evaluateFreshnessFromCanvas(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let darkPixels = 0;
    let brownPixels = 0;
    let vividPixels = 0;
    let warmFreshPixels = 0;
    let greenFreshPixels = 0;
    let usablePixels = 0;
    let brightnessSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];
      if (alpha < 80) continue;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const brightness = (r + g + b) / 3;
      const saturation = max ? (max - min) / max : 0;
      usablePixels += 1;
      brightnessSum += brightness;

      if (brightness < 58) darkPixels += 1;
      if (r > 70 && r > g * 0.92 && g > b * 1.15 && brightness < 150) brownPixels += 1;
      if (saturation > 0.22 && brightness > 65) vividPixels += 1;
      if (r > 125 && g > 70 && b < 105 && saturation > 0.22) warmFreshPixels += 1;
      if (g > r * 0.92 && g > b * 1.08 && saturation > 0.18 && brightness > 58) greenFreshPixels += 1;
    }

    const total = Math.max(1, usablePixels || width * height);
    const darkRatio = darkPixels / total;
    const brownRatio = brownPixels / total;
    const vividRatio = vividPixels / total;
    const freshColorRatio = (warmFreshPixels + greenFreshPixels) / total;
    const avgBrightness = brightnessSum / total;
    const exposurePenalty = avgBrightness < 55 || avgBrightness > 225 ? 16 : 0;

    if (freshColorRatio < 0.04 && vividRatio < 0.16) {
      return {
        label: "Could not confirm freshness",
        advice: "Try again with one fruit or vegetable centered in good light",
        score: 0,
        confidence: 0,
        source: "local",
        detectedClass: null,
        details: { darkRatio, brownRatio, vividRatio, avgBrightness }
      };
    }

    const score = Math.max(
      0,
      Math.min(100, Math.round(72 + freshColorRatio * 32 + vividRatio * 18 - brownRatio * 120 - darkRatio * 58 - exposurePenalty))
    );

    let label = "Looks fresh";
    let advice = "Good for today";
    if (score < 45) {
      label = "May be overripe";
      advice = "Use with caution and inspect before eating";
    } else if (score < 68) {
      label = "Use within 1-2 days";
      advice = "It looks usable, but not at peak freshness";
    } else if (score < 82) {
      label = "Good for today";
      advice = "Best used soon for top taste";
    }

    return {
      label,
      advice,
      score,
      confidence: Math.max(48, Math.min(94, Math.round(56 + Math.abs(score - 50) * 0.72))),
      source: "local",
      detectedClass: null,
      details: { darkRatio, brownRatio, vividRatio, avgBrightness }
    };
  }

  async function checkFreshnessWithModel(imageDataUrl) {
    const data = await api("/api/freshness/check", {
      method: "POST",
      body: JSON.stringify({ image: imageDataUrl })
    });
    return data.result;
  }

  async function analyzeFreshnessImage(source) {
    const canvas = freshnessCanvasRef.current;
    if (!canvas || !source) return;

    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    if (!sourceWidth || !sourceHeight) {
      showToast("Image is not ready yet");
      return;
    }

    const size = 180;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cropSize = Math.min(sourceWidth, sourceHeight);
    const sx = (sourceWidth - cropSize) / 2;
    const sy = (sourceHeight - cropSize) / 2;
    ctx.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, size, size);

    setIsFreshnessAnalyzing(true);
    try {
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.86);
      const modelResult = await checkFreshnessWithModel(imageDataUrl);
      setFreshnessResult(modelResult);
    } catch (err) {
      const localResult = evaluateFreshnessFromCanvas(canvas) || {
        label: "Could not confirm freshness",
        advice: "Freshness model is unavailable. Try again with one fruit or vegetable centered in good light.",
        score: 0,
        confidence: 0,
        source: "local",
        detectedClass: null
      };
      setFreshnessResult({
        ...localResult,
        advice: `${localResult.advice} Model check is temporarily unavailable.`
      });
      const detail = err?.data?.details?.failures?.[0];
      showToast(detail?.error ? `Freshness model issue: ${detail.error}` : "Freshness model unavailable; showing local estimate");
    } finally {
      setIsFreshnessAnalyzing(false);
    }
  }

  function stopFreshnessCamera() {
    if (freshnessStreamRef.current) {
      freshnessStreamRef.current.getTracks().forEach((track) => track.stop());
      freshnessStreamRef.current = null;
    }
    if (freshnessVideoRef.current) {
      freshnessVideoRef.current.srcObject = null;
    }
    setFreshnessCameraOn(false);
  }

  async function startFreshnessCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Camera is not supported in this browser");
      return;
    }

    try {
      stopFreshnessCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      freshnessStreamRef.current = stream;
      if (freshnessVideoRef.current) {
        freshnessVideoRef.current.srcObject = stream;
        await freshnessVideoRef.current.play();
      }
      setFreshnessCameraOn(true);
      setFreshnessResult(null);
    } catch {
      showToast("Unable to open camera");
    }
  }

  function handleFreshnessUpload(file) {
    if (!file) return;
    const image = new Image();
    image.onload = () => {
      analyzeFreshnessImage(image);
      URL.revokeObjectURL(image.src);
    };
    image.onerror = () => showToast("Unable to read this image");
    image.src = URL.createObjectURL(file);
  }

  async function loadGestureRecognizer() {
    if (gestureRecognizerRef.current) return gestureRecognizerRef.current;
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18");
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
    );
    const options = {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55
    };

    let recognizer;
    try {
      recognizer = await vision.GestureRecognizer.createFromOptions(filesetResolver, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "GPU" }
      });
    } catch {
      recognizer = await vision.GestureRecognizer.createFromOptions(filesetResolver, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" }
      });
    }
    gestureRecognizerRef.current = recognizer;
    return recognizer;
  }

  function stopGestureCamera() {
    if (gestureRafRef.current) {
      cancelAnimationFrame(gestureRafRef.current);
      gestureRafRef.current = null;
    }
    if (gestureStreamRef.current) {
      gestureStreamRef.current.getTracks().forEach((track) => track.stop());
      gestureStreamRef.current = null;
    }
    if (gestureVideoRef.current) {
      gestureVideoRef.current.srcObject = null;
    }
    gestureStableRef.current = { name: "", count: 0, score: 0 };
    gestureLastVideoTimeRef.current = -1;
    gestureCursorRef.current = { x: 0, y: 0, targetId: "", startedAt: 0, lastUpdateAt: 0, cooldownUntil: 0 };
    setGestureCursor({ active: false, x: 0, y: 0, progress: 0, label: "" });
    setGestureCameraOn(false);
  }

  function getGestureCommand(gestureName) {
    const commands = {
      Thumb_Up: {
        label: "Thumbs Up",
        action: showCheckoutRef.current ? "Next checkout step" : "Add selected product"
      },
      Thumb_Down: {
        label: "Thumbs Down",
        action: "Remove the latest cart item"
      },
      Pointing_Up: {
        label: "Pointing Up",
        action: "Select next visible product"
      },
      Open_Palm: {
        label: "Open Palm",
        action: "Scroll down"
      },
      Closed_Fist: {
        label: "Closed Fist",
        action: "Scroll up"
      },
      Victory: {
        label: "Victory",
        action: showCheckoutRef.current ? "Checkout is already open" : "Open checkout"
      },
      ILoveYou: {
        label: "I Love You",
        action: "Open orders"
      }
    };

    return commands[gestureName] || {
      label: String(gestureName || "Unknown").replace(/_/g, " "),
      action: "Hold a supported gesture"
    };
  }

  function getThumbUpCheckoutAction() {
    const step = checkoutStepRef.current || checkoutStep;
    if (step < 3) return `Go to checkout step ${step + 1}`;
    return "Ask before placing order";
  }

  function requestGestureOrderConfirmation() {
    if (!canContinueCheckoutStep(1) || !canContinueCheckoutStep(2)) return false;
    pendingAssistantOrderConfirmationRef.current = true;
    setPendingAssistantOrderConfirmation(true);
    setAssistantMessage("Confirm order placement using the buttons, or say yes to place order.");
    setGestureStatus("Final checkout step ready. Confirm before placing the order.");
    showToast("Confirm order before placing");
    return true;
  }

  function handleCheckoutGestureNext() {
    const step = checkoutStepRef.current || checkoutStep;
    if (step < 3) {
      if (!canContinueCheckoutStep(step)) return;
      setCheckoutNotice("");
      setCheckoutStep(Math.min(step + 1, 3));
      setGestureStatus(`Thumbs Up confirmed: moved to checkout step ${Math.min(step + 1, 3)}.`);
      setAssistantMessage(step + 1 === 3 ? "Review your order. Hold thumbs up again to confirm placement." : "Moved to payment step.");
      return;
    }
    requestGestureOrderConfirmation();
  }

  function getGestureTargetProduct() {
    if (previewProduct && !previewProduct.outOfStock) return previewProduct;

    const selectedId = gestureSelectedProductIdRef.current || gestureSelectedProductId;
    if (selectedId) {
      const selectedProduct = productsRef.current.find((product) => String(product.id) === String(selectedId) && !product.outOfStock);
      if (selectedProduct) return selectedProduct;
    }

    const cards = Array.from(document.querySelectorAll("[data-gesture-product-id]"));
    if (!cards.length) return null;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const focusX = viewportWidth / 2;
    const focusY = viewportHeight * 0.48;

    let best = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      const visibleArea = visibleWidth * visibleHeight;
      const cardArea = Math.max(1, rect.width * rect.height);
      const visibleRatio = visibleArea / cardArea;

      if (visibleRatio < 0.45) continue;

      const cardX = rect.left + rect.width / 2;
      const cardY = rect.top + rect.height / 2;
      const distance = Math.hypot(cardX - focusX, cardY - focusY);
      const centerBonus = rect.top <= focusY && rect.bottom >= focusY ? 160 : 0;
      const score = distance - centerBonus - visibleRatio * 90;

      if (!best || score < best.score) {
        best = {
          score,
          productId: card.getAttribute("data-gesture-product-id")
        };
      }
    }

    if (!best?.productId) return null;
    return productsRef.current.find((product) => String(product.id) === String(best.productId) && !product.outOfStock) || null;
  }

  function getVisibleGestureProducts() {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return Array.from(document.querySelectorAll("[data-gesture-product-id]"))
      .map((card) => {
        const rect = card.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const visibleRatio = (visibleWidth * visibleHeight) / Math.max(1, rect.width * rect.height);
        return {
          id: card.getAttribute("data-gesture-product-id"),
          rect,
          visibleRatio
        };
      })
      .filter((item) => item.id && item.visibleRatio >= 0.35)
      .sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left));
  }

  function selectGestureProduct(direction = 1) {
    const visibleProducts = getVisibleGestureProducts();
    if (!visibleProducts.length) {
      setGestureStatus("No visible product cards. Scroll to products, then point up to select.");
      return null;
    }

    const selectedId = gestureSelectedProductIdRef.current || gestureSelectedProductId;
    const currentIndex = visibleProducts.findIndex((item) => String(item.id) === String(selectedId));
    const fallbackProduct = getGestureTargetProduct();
    const fallbackIndex = fallbackProduct
      ? visibleProducts.findIndex((item) => String(item.id) === String(fallbackProduct.id))
      : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    const nextIndex = baseIndex >= 0
      ? (baseIndex + direction + visibleProducts.length) % visibleProducts.length
      : 0;
    const nextId = visibleProducts[nextIndex].id;
    const product = productsRef.current.find((item) => String(item.id) === String(nextId) && !item.outOfStock) || null;

    if (!product) return null;
    gestureSelectedProductIdRef.current = String(product.id);
    setGestureSelectedProductId(String(product.id));
    setGestureStatus(`Selected ${product.name}. Hold thumbs up to add it.`);
    setAssistantMessage(`Selected ${product.name}. Use pointing up to move across visible products.`);
    return product;
  }

  function selectGestureProductById(productId, reason = "cursor") {
    const product = productsRef.current.find((item) => String(item.id) === String(productId) && !item.outOfStock);
    if (!product) return null;

    gestureSelectedProductIdRef.current = String(product.id);
    setGestureSelectedProductId(String(product.id));
    const reasonLabel = reason === "cursor" ? "Finger cursor" : "Gesture";
    setGestureStatus(`${reasonLabel} selected ${product.name}. Hold thumbs up to add it.`);
    setAssistantMessage(`Selected ${product.name}. Hold thumbs up to add it to cart.`);
    return product;
  }

  function getProductUnderGestureCursor(x, y) {
    const element = document.elementFromPoint(x, y);
    const card = element?.closest?.("[data-gesture-product-id]");
    if (!card) return null;
    const productId = card.getAttribute("data-gesture-product-id");
    const product = productsRef.current.find((item) => String(item.id) === String(productId) && !item.outOfStock);
    return product || null;
  }

  function getLandmarkDistance(a, b) {
    if (!a || !b) return 0;
    return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0));
  }

  function isFingerExtended(landmarks, tipIndex, pipIndex) {
    const wrist = landmarks?.[0];
    const tip = landmarks?.[tipIndex];
    const pip = landmarks?.[pipIndex];
    if (!wrist || !tip || !pip) return false;
    return getLandmarkDistance(tip, wrist) > getLandmarkDistance(pip, wrist) * 1.04;
  }

  function isPointingPose(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;
    const indexExtended = isFingerExtended(landmarks, 8, 6);
    const middleExtended = isFingerExtended(landmarks, 12, 10);
    const ringExtended = isFingerExtended(landmarks, 16, 14);
    const pinkyExtended = isFingerExtended(landmarks, 20, 18);

    return indexExtended && [middleExtended, ringExtended, pinkyExtended].filter(Boolean).length <= 1;
  }

  function updateGesturePointer(landmarks) {
    const indexTip = landmarks?.[8];
    if (!indexTip || !Number.isFinite(indexTip.x) || !Number.isFinite(indexTip.y) || !isPointingPose(landmarks)) {
      gestureCursorRef.current.targetId = "";
      gestureCursorRef.current.startedAt = 0;
      setGestureCursor((current) => ({ ...current, active: false, progress: 0, label: "" }));
      return;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const rawX = (1 - Math.max(0, Math.min(1, indexTip.x))) * viewportWidth;
    const rawY = Math.max(0, Math.min(1, indexTip.y)) * viewportHeight;
    const previous = gestureCursorRef.current;
    const x = previous.lastUpdateAt ? previous.x * 0.55 + rawX * 0.45 : rawX;
    const y = previous.lastUpdateAt ? previous.y * 0.55 + rawY * 0.45 : rawY;
    const now = performance.now();
    const product = getProductUnderGestureCursor(x, y);
    const targetId = product ? String(product.id) : "";

    if (now < Number(previous.cooldownUntil || 0)) {
      previous.x = x;
      previous.y = y;
      previous.lastUpdateAt = now;
      setGestureCursor({ active: true, x, y, progress: 0, label: "Added. Move to another product" });
      return;
    }

    if (targetId && targetId !== previous.targetId) {
      previous.startedAt = now;
    } else if (!targetId) {
      previous.startedAt = 0;
    } else if (!previous.startedAt) {
      previous.startedAt = now;
    }

    previous.x = x;
    previous.y = y;
    previous.targetId = targetId;
    previous.lastUpdateAt = now;

    const elapsed = targetId && previous.startedAt ? now - previous.startedAt : 0;
    const progress = Math.min(100, Math.round((elapsed / GESTURE_DWELL_MS) * 100));
    const label = product ? `Hold to add ${product.name}` : "Point at a product";

    setGestureCursor({ active: true, x, y, progress, label });

    if (product && elapsed >= GESTURE_DWELL_MS) {
      selectGestureProductById(product.id, "cursor");
      addProductDirectly(product);
      setGestureStatus(`Finger cursor added ${product.name} to cart.`);
      setAssistantMessage(`Added ${product.name}. Move your finger away before adding another product.`);
      previous.startedAt = 0;
      previous.targetId = "";
      previous.cooldownUntil = now + 1200;
      setGestureCursor({ active: true, x, y, progress: 100, label: `Added ${product.name}` });
    }
  }

  function handleGestureAction(gestureName) {
    const now = Date.now();
    const last = gestureLastActionRef.current;
    if (!gestureName || (last.name === gestureName && now - last.at < 1800) || now - last.at < 1200) return;
    gestureLastActionRef.current = { name: gestureName, at: now };
    const command = getGestureCommand(gestureName);

    if (gestureName === "Thumb_Up") {
      if (showCheckoutRef.current) {
        handleCheckoutGestureNext();
        return;
      }
      const product = getGestureTargetProduct();
      if (product) {
        addProductDirectly(product);
        setGestureStatus(`Confirmed ${command.label}: added centered product ${product.name}`);
        setAssistantMessage(`Added ${product.name}. Center a different product before thumbs up to choose another item.`);
      } else {
        setGestureStatus("No centered product found. Scroll until the product card is clearly in the middle.");
        setAssistantMessage("Center a product card, then hold thumbs up.");
      }
      return;
    }

    if (gestureName === "Pointing_Up") {
      const product = selectGestureProduct(1);
      if (product) {
        setGestureStatus(`Confirmed ${command.label}: selected ${product.name}`);
      }
      return;
    }

    if (gestureName === "Thumb_Down") {
      const item = cartRef.current[cartRef.current.length - 1];
      if (!item) {
        setGestureStatus("Cart is empty");
        setAssistantMessage("Cart is empty");
        return;
      }
      setCart((current) => current.slice(0, -1));
      setGestureStatus(`Confirmed ${command.label}: removed ${item.name}`);
      setAssistantMessage(`Removed ${item.name}`);
      showToast(`Removed ${item.name}`);
      return;
    }

    if (gestureName === "Open_Palm") {
      scrollPageByDirection("down");
      setGestureStatus(`Confirmed ${command.label}: scrolling down`);
      return;
    }

    if (gestureName === "Victory") {
      if (showCheckoutRef.current) {
        setGestureStatus("Checkout is already open. Hold thumbs up for Next, then thumbs up again on Review to confirm.");
        setAssistantMessage("Checkout is open. Use thumbs up to move forward.");
        return;
      }
      openCheckoutFlow();
      setGestureStatus(`Confirmed ${command.label}: opening checkout at step 1`);
      return;
    }

    if (gestureName === "ILoveYou") {
      openOrdersByVoice();
      setGestureStatus(`Confirmed ${command.label}: opening orders`);
      return;
    }

    if (gestureName === "Closed_Fist") {
      scrollPageByDirection("up");
      setGestureStatus(`Confirmed ${command.label}: scrolling up`);
    }
  }

  function updateStableGesture(gesture) {
    const name = gesture?.categoryName || "";
    const score = Number(gesture?.score || 0);
    const command = getGestureCommand(name);
    const confidence = Math.round(score * 100);

    if (!name || score < 0.62 || name === "None") {
      gestureStableRef.current = { name: "", count: 0, score: 0 };
      setGestureDetected({ label: "Looking", confidence: 0, action: "Show one hand clearly" });
      return;
    }

    const stable = gestureStableRef.current;
    if (stable.name === name) {
      stable.count += 1;
      stable.score = Math.max(stable.score, score);
    } else {
      stable.name = name;
      stable.count = 1;
      stable.score = score;
    }

    const progress = Math.min(100, Math.round((stable.count / 4) * 100));
    const targetProduct = name === "Thumb_Up" && !showCheckoutRef.current ? getGestureTargetProduct() : null;
    const selectedProduct = gestureSelectedProductIdRef.current
      ? productsRef.current.find((product) => String(product.id) === String(gestureSelectedProductIdRef.current))
      : null;
    const action = targetProduct
      ? `Add ${targetProduct.name}`
      : name === "Thumb_Up" && showCheckoutRef.current
        ? getThumbUpCheckoutAction()
        : name === "Pointing_Up" && selectedProduct
          ? `Move selection from ${selectedProduct.name}`
          : command.action;
    setGestureDetected({ label: command.label, confidence, action });
    setGestureStatus(`${command.label} detected (${confidence}%). ${action}. Hold steady ${progress}%.`);

    if (stable.count >= 4) {
      stable.count = 0;
      handleGestureAction(name);
    }
  }

  function scanGestureFrame() {
    const video = gestureVideoRef.current;
    const recognizer = gestureRecognizerRef.current;
    if (!video || !recognizer || video.readyState < 2) {
      gestureRafRef.current = requestAnimationFrame(scanGestureFrame);
      return;
    }

    if (video.currentTime !== gestureLastVideoTimeRef.current) {
      gestureLastVideoTimeRef.current = video.currentTime;
      try {
        const result = recognizer.recognizeForVideo(video, performance.now());
        const landmarks = result?.landmarks?.[0] || result?.handLandmarks?.[0] || [];
        updateGesturePointer(landmarks);
        updateStableGesture(result?.gestures?.[0]?.[0]);
      } catch {
        setGestureStatus("Gesture tracking paused. Keep your hand in view.");
      }
    }

    gestureRafRef.current = requestAnimationFrame(scanGestureFrame);
  }

  async function startGestureCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Camera is not supported in this browser");
      return;
    }
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      showToast("Gestures need HTTPS or localhost camera access");
      setGestureStatus("Open this site over HTTPS or localhost to use gesture camera.");
      return;
    }

    setIsGestureLoading(true);
    setGestureStatus("Loading gesture model...");
    setGestureDetected({ label: "Loading", confidence: 0, action: "Preparing camera" });
    try {
      const recognizer = await loadGestureRecognizer();
      stopGestureCamera();
      gestureRecognizerRef.current = recognizer;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 960 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 }
        },
        audio: false
      });
      gestureStreamRef.current = stream;
      if (gestureVideoRef.current) {
        gestureVideoRef.current.srcObject = stream;
        await gestureVideoRef.current.play();
      }
      setGestureCameraOn(true);
      setGestureStatus("Gesture mode ready. Point your index finger over a product for a moment to add it.");
      setGestureDetected({ label: "Ready", confidence: 0, action: "Finger hold adds, palm down, fist up" });
      setAssistantMessage("Gesture mode ready. Point over a product to add it, open palm to go down, fist to go up.");
      gestureLastActionRef.current = { name: "", at: 0 };
      gestureStableRef.current = { name: "", count: 0, score: 0 };
      gestureLastVideoTimeRef.current = -1;
      gestureSelectedProductIdRef.current = "";
      gestureCursorRef.current = { x: 0, y: 0, targetId: "", startedAt: 0, lastUpdateAt: 0, cooldownUntil: 0 };
      setGestureSelectedProductId("");
      gestureRafRef.current = requestAnimationFrame(scanGestureFrame);
    } catch (err) {
      console.error("Gesture mode failed:", err && err.message ? err.message : err);
      showToast("Unable to start gesture mode");
      setGestureStatus("Gesture mode could not start. Check camera permission and network access.");
      setGestureDetected({ label: "Blocked", confidence: 0, action: "Allow camera permission" });
      stopGestureCamera();
    } finally {
      setIsGestureLoading(false);
    }
  }

  function openCheckoutFlow() {
    const currentCart = cartRef.current || cart;
    const currentUser = userRef.current || user;
    if (!currentCart.length) {
      showToast("Cart is empty");
      return;
    }
    if (!currentUser) {
      setShowAuth(true);
      showToast("Please login or signup first");
      return;
    }
    setCheckout((prev) => ({
      ...prev,
      fullName: prev.fullName || currentUser.name || "",
      contactNumber: prev.contactNumber || currentUser.mobileNumber || ""
    }));
    setCheckoutStep(1);
    setShowCheckout(true);
  }

  function closeCheckoutFlow() {
    setShowCheckout(false);
    setCheckoutStep(1);
    setCheckoutNotice("");
  }

  function canContinueCheckoutStep(step = checkoutStep, showMessage = true) {
    const notify = (message) => {
      if (!showMessage) return;
      showCheckoutNotice(message);
      if (!showCheckout) showToast(message);
    };

    if (step === 1) {
      if (String(checkout.fullName || "").trim().length < 2) {
        notify("Please enter full name");
        return false;
      }
      if (!/^\d{10}$/.test(String(checkout.contactNumber || "").trim())) {
        notify("Please enter a valid 10-digit mobile number");
        return false;
      }
      if (checkout.paymentMethod !== "PICKUP" && String(checkout.address || "").trim().length < 8) {
        notify("Please enter delivery address");
        return false;
      }
    }

    if (step === 2) {
      const tip = Number(checkout.tipAmount || 0);
      if (!["COD", "PICKUP"].includes(checkout.paymentMethod)) {
        notify("Select payment method");
        return false;
      }
      if (!Number.isFinite(tip) || tip < 0 || tip > 5000) {
        notify("Tip should be between 0 and 5000");
        return false;
      }
    }

    if (showMessage) setCheckoutNotice("");
    return true;
  }

  function goToNextCheckoutStep() {
    if (!canContinueCheckoutStep(checkoutStep)) return;
    setCheckoutNotice("");
    setCheckoutStep((step) => Math.min(step + 1, 3));
  }

  function stopNativeVoiceCommand(message = "Voice command stopped") {
    nativeVoiceActiveRef.current = false;
    nativeVoiceSessionRef.current += 1;
    if (nativeVoiceRestartTimerRef.current) {
      window.clearTimeout(nativeVoiceRestartTimerRef.current);
      nativeVoiceRestartTimerRef.current = null;
    }
    NativeSpeechRecognition.stop().catch(() => {});
    setIsVoiceListening(false);
    setIsVoiceCommandActive(false);
    setAssistantMessage(message);
  }

  async function listenForNativeVoiceCommand(sessionId) {
    if (!nativeVoiceActiveRef.current || nativeVoiceSessionRef.current !== sessionId) return;

    setIsVoiceListening(true);
    setIsVoiceCommandActive(true);

    try {
      const result = await NativeSpeechRecognition.start({
        language: "en-IN",
        maxResults: 1,
        partialResults: false,
        popup: false
      });

      if (!nativeVoiceActiveRef.current || nativeVoiceSessionRef.current !== sessionId) return;

      const transcript = String(result?.matches?.[0] || "").trim();
      setIsVoiceListening(false);

      if (transcript) {
        await runShoppingCommand(transcript);
      } else {
        setAssistantMessage("I did not hear a command. Listening again...");
      }

      if (!nativeVoiceActiveRef.current || nativeVoiceSessionRef.current !== sessionId) return;
      nativeVoiceRestartTimerRef.current = window.setTimeout(() => {
        listenForNativeVoiceCommand(sessionId);
      }, 450);
    } catch (err) {
      if (!nativeVoiceActiveRef.current || nativeVoiceSessionRef.current !== sessionId) return;

      setIsVoiceListening(false);
      const message = String(err?.message || err || "");
      if (/permission/i.test(message)) {
        stopNativeVoiceCommand("Please allow microphone permission to use voice commands.");
        showToast("Microphone permission needed");
        return;
      }

      if (/no[-\s]?speech|aborted|cancel/i.test(message)) {
        nativeVoiceRestartTimerRef.current = window.setTimeout(() => {
          listenForNativeVoiceCommand(sessionId);
        }, 600);
        return;
      }

      stopNativeVoiceCommand("Unable to capture voice. Please try again.");
      showToast("Unable to capture voice");
    }
  }

  async function startVoiceSearch() {
    if (!voiceSupported) {
      showToast("Voice search is not supported in this browser");
      return;
    }

    if (IS_NATIVE_APP && Capacitor.isPluginAvailable("SpeechRecognition")) {
      if (nativeVoiceActiveRef.current || isVoiceListening) {
        stopNativeVoiceCommand();
        return;
      }

      try {
        const permission = await NativeSpeechRecognition.checkPermissions();
        if (permission.speechRecognition !== "granted") {
          const requested = await NativeSpeechRecognition.requestPermissions();
          if (requested.speechRecognition !== "granted") {
            setAssistantMessage("Please allow microphone permission to use voice commands.");
            showToast("Microphone permission needed");
            return;
          }
        }

        nativeVoiceActiveRef.current = true;
        const sessionId = nativeVoiceSessionRef.current + 1;
        nativeVoiceSessionRef.current = sessionId;
        setIsVoiceListening(true);
        setIsVoiceCommandActive(true);
        setAssistantTranscript("");
        setAssistantMessage("Listening for voice commands");
        listenForNativeVoiceCommand(sessionId);
      } catch (err) {
        const message = String(err?.message || err || "");
        if (/permission/i.test(message)) {
          stopNativeVoiceCommand("Please allow microphone permission to use voice commands.");
          showToast("Microphone permission needed");
        } else {
          stopNativeVoiceCommand("Unable to capture voice. Please try again.");
          showToast("Unable to capture voice");
        }
      }
      return;
    }

    const recognition = voiceRecognitionRef.current;
    if (!recognition) {
      showToast("Voice search is not available right now");
      return;
    }

    if (voiceShouldListenRef.current || isVoiceListening) {
      voiceShouldListenRef.current = false;
      if (voiceRestartTimerRef.current) {
        window.clearTimeout(voiceRestartTimerRef.current);
        voiceRestartTimerRef.current = null;
      }
      recognition.stop();
      setIsVoiceListening(false);
      setIsVoiceCommandActive(false);
      setAssistantMessage("Voice command stopped");
      return;
    }

    voiceShouldListenRef.current = true;
    setIsVoiceCommandActive(true);
    setAssistantMessage("Listening for voice commands");
    try {
      recognition.start();
    } catch {
      // Start can throw when called repeatedly; let onend reset state.
    }
  }

  function openComplaintFlow() {
    const latestOrder = orders && orders.length ? `#${orders[0].id.slice(-6).toUpperCase()}` : "";
    setComplaintForm((s) => ({ ...s, orderNumber: s.orderNumber || latestOrder }));
    setShowComplaint(true);
  }

  function openProfileTool(openTool) {
    setProfileToolReturnToProfile(true);
    setShowAppProfileMenu(false);
    openTool();
  }

  function closeProfileTool(closeTool) {
    closeTool();
    setProfileToolReturnToProfile(false);
  }

  function returnToProfileFromTool(closeTool) {
    closeTool();
    setProfileToolReturnToProfile(false);
    setShowAppProfileMenu(true);
  }

  function openAccountPanel(panel, options = {}) {
    setAccountPanel(panel);
    setAccountPanelReturnToProfile(Boolean(options.returnToProfile));
    setShowMainMenu(false);
    if (panel === "orders") loadOrders();
    if (panel === "complaints") loadComplaints();
  }

  function closeAccountPanel() {
    setAccountPanel(null);
    setAccountPanelReturnToProfile(false);
  }

  function returnToProfileTools() {
    setAccountPanel(null);
    setAccountPanelReturnToProfile(false);
    setShowAppProfileMenu(true);
  }

  function handleCustomerAppNav(target) {
    setShowMainMenu(false);
    closeAccountPanel();
    if (target === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (target === "products") {
      productsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (target === "cart") {
      cartPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!user) {
      setAuthMode("login");
      setShowAuth(true);
      return;
    }
    if (target === "orders") {
      openAccountPanel("orders");
      return;
    }
    if (target === "profile") {
      setShowAppProfileMenu(true);
    }
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
    closeAccountPanel();
    setProfileToolReturnToProfile(false);
    setShowProfile(false);
    setShowWallet(false);
    setShowComplaint(false);
    setShowAppProfileMenu(false);
    setShowMenuOrders(false);
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

  function addProductDirectly(product) {
    if (!product) return;
    const firstAvailableVariant = (product.variants || []).find((v) => Number(v.stock || 0) > 0);
    addToCart(product, firstAvailableVariant || null);
  }

  async function placeOrder() {
    if (isPlacingOrderRef.current) return false;
    isPlacingOrderRef.current = true;
    setIsPlacingOrder(true);
    try {
      const currentCheckout = checkoutRef.current || checkout;
      const currentCart = cartRef.current || cart;
      const payload = {
        fullName: String(currentCheckout.fullName || "").trim(),
        contactNumber: String(currentCheckout.contactNumber || "").trim(),
        tipAmount: Number(currentCheckout.tipAmount || 0),
        promoCode: sanitizePromoCode(currentCheckout.promoCode),
        useWalletCoins: Boolean(currentCheckout.useWalletCoins),
        paymentMethod: currentCheckout.paymentMethod,
        address: currentCheckout.address,
        items: currentCart.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
          variant: c.variant
        }))
      };

      if (payload.fullName.length < 2) {
        showToast("Please enter full name");
        return false;
      }
      if (!/^\d{10}$/.test(payload.contactNumber)) {
        showToast("Please enter a valid 10-digit mobile number");
        return false;
      }
      if (!Number.isFinite(payload.tipAmount) || payload.tipAmount < 0 || payload.tipAmount > 5000) {
        showToast("Tip should be between 0 and 5000");
        return false;
      }

      const data = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setCart([]);
      setCheckout((prev) => ({ ...prev, tipAmount: "", promoCode: "", useWalletCoins: false }));
      setPromoPreview({ valid: false, code: "", discountAmount: 0, message: "No promo applied" });
      if (data.walletBalance !== undefined) {
        setWallet((prev) => ({ ...prev, balance: Number(data.walletBalance || 0) }));
      }
      setShowCheckout(false);
      setCelebrationOrderCode(data.orderId.slice(-6).toUpperCase());
      setShowOrderCelebration(true);
      setTimeout(() => setShowOrderCelebration(false), 2600);
      showToast(`Order placed successfully (#${data.orderId.slice(-6).toUpperCase()})`);
      loadOrders();
      loadWallet();
      return true;
    } catch (err) {
      showToast(err.message);
      return false;
    } finally {
      isPlacingOrderRef.current = false;
      setIsPlacingOrder(false);
    }
  }

  async function applyPromoCode() {
    const code = sanitizePromoCode(checkout.promoCode);
    if (!code) {
      setPromoPreview({ valid: false, code: "", discountAmount: 0, message: "No promo applied" });
      setCheckoutNotice("Enter a promo code to apply");
      return;
    }
    setCheckout((current) => ({ ...current, promoCode: code }));

    try {
      const data = await api(`/api/promos/validate?code=${encodeURIComponent(code)}&subtotal=${cartSubtotal}`);
      setPromoPreview({
        valid: Boolean(data.valid),
        code: data.code || code.toUpperCase(),
        discountAmount: Number(data.discountAmount || 0),
        message: data.valid ? `Promo applied: ${data.discountPercent}% off` : "Promo not applied"
      });
      setCheckoutNotice(data.valid ? `Promo applied: ${data.discountPercent}% off` : "Promo not applied");
    } catch (err) {
      setPromoPreview({ valid: false, code: "", discountAmount: 0, message: err.message });
      setCheckoutNotice(err.message);
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

  function openManageOrder(order) {
    setManagingOrder({
      ...order,
      editItems: (order.items || []).map((item) => ({
        productId: item.productId,
        productName: item.productName,
        variantName: item.variantName || null,
        quantity: Number(item.quantity || 1)
      }))
    });
  }

  function updateManagingOrderQuantity(index, delta) {
    setManagingOrder((current) => {
      if (!current) return current;
      const editItems = current.editItems
        .map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Math.max(0, Number(item.quantity || 0) + delta) } : item)
        .filter((item) => item.quantity > 0);
      return { ...current, editItems };
    });
  }

  function addCartToManagingOrder() {
    if (!cart.length) {
      showToast("Cart is empty");
      return;
    }
    setManagingOrder((current) => {
      if (!current) return current;
      const map = new Map((current.editItems || []).map((item) => [`${item.productId}::${item.variantName || ""}`, { ...item }]));
      for (const item of cart) {
        const key = `${item.productId}::${item.variant || ""}`;
        if (map.has(key)) map.get(key).quantity += Number(item.quantity || 1);
        else {
          map.set(key, {
            productId: item.productId,
            productName: item.name,
            variantName: item.variant || null,
            quantity: Number(item.quantity || 1)
          });
        }
      }
      return { ...current, editItems: Array.from(map.values()) };
    });
    showToast("Cart items added to order draft");
  }

  async function saveManagedOrder() {
    if (!managingOrder) return;
    const items = (managingOrder.editItems || []).filter((item) => Number(item.quantity || 0) > 0);
    if (!items.length) {
      showToast("Order must have at least one item");
      return;
    }

    try {
      await api(`/api/orders/${managingOrder.id}/items`, {
        method: "PUT",
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            variant: item.variantName || null
          }))
        })
      });
      showToast("Order modified");
      setManagingOrder(null);
      await Promise.all([loadOrders(), loadProducts(), loadWallet()]);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function cancelCustomerOrder(orderId) {
    const confirmed = window.confirm("Cancel this order? This is available only within 2 hours of placing it.");
    if (!confirmed) return;
    try {
      await api(`/api/orders/${orderId}/cancel`, { method: "POST" });
      showToast("Order canceled");
      setManagingOrder(null);
      await Promise.all([loadOrders(), loadProducts(), loadWallet()]);
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderProductCard(p) {
    const imagePath = p.imagePath ? resolveAssetUrl(p.imagePath) : getProductImagePath(p.name, imageFiles);

    return (
      <article
        className={`product-card ${String(gestureSelectedProductId) === String(p.id) ? "gesture-selected" : ""}`}
        key={p.id}
        data-gesture-product-id={p.id}
        data-gesture-product-name={p.name}
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
              className={`product-image ${loadedProductImages.has(imagePath) ? "is-loaded" : ""}`}
              src={imagePath}
              alt={p.name}
              loading={IS_NATIVE_APP ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={IS_NATIVE_APP ? "high" : "auto"}
              onLoad={() => {
                setLoadedProductImages((current) => {
                  if (current.has(imagePath)) return current;
                  const next = new Set(current);
                  next.add(imagePath);
                  return next;
                });
              }}
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
              addProductDirectly(p);
            }}
          >
            {p.outOfStock ? "Unavailable" : "Add to Cart"}
          </button>
        </div>
      </article>
    );
  }

  async function loadOrders() {
    const currentUser = userRef.current || user;
    if (!currentUser) {
      setOrders([]);
      return [];
    }

    try {
      const data = await api("/api/orders/my");
      const nextOrders = data.orders || [];
      setOrders(nextOrders);
      return nextOrders;
    } catch {
      setOrders([]);
      return [];
    }
  }

  async function loadComplaints() {
    const currentUser = userRef.current || user;
    if (!currentUser) {
      setComplaints([]);
      return [];
    }

    try {
      const data = await api("/api/complaints/my");
      const nextComplaints = data.complaints || [];
      setComplaints(nextComplaints);
      return nextComplaints;
    } catch {
      setComplaints([]);
      return [];
    }
  }

  async function loadWallet() {
    const currentUser = userRef.current || user;
    if (!currentUser) {
      const emptyWallet = { balance: 0, transactions: [], rewardRate: null };
      setWallet(emptyWallet);
      return emptyWallet;
    }

    try {
      const data = await api("/api/wallet");
      const nextWallet = {
        balance: Number(data.balance || 0),
        transactions: data.transactions || [],
        rewardRate: data.rewardRate || null
      };
      setWallet(nextWallet);
      return nextWallet;
    } catch {
      const fallbackWallet = { balance: Number(currentUser.walletCoins || 0), transactions: [], rewardRate: null };
      setWallet(fallbackWallet);
      return fallbackWallet;
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
      const compactTrigger = window.innerWidth <= 980 ? 340 : 150;
      setIsFilterCompact(productsTop <= compactTrigger);
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
    if (IS_NATIVE_APP && Capacitor.isPluginAvailable("SpeechRecognition")) {
      setVoiceSupported(true);
      return () => {
        stopNativeVoiceCommand("");
      };
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceSupported(false);
      voiceRecognitionRef.current = null;
      return undefined;
    }

    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsVoiceListening(true);
    recognition.onresult = (event) => {
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;
        const transcript = String(result?.[0]?.transcript || "").trim();
        if (transcript) runShoppingCommand(transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event?.error === "aborted" || event?.error === "no-speech") return;
      voiceShouldListenRef.current = false;
      setIsVoiceCommandActive(false);
      showToast("Unable to capture voice. Please try again.");
    };
    recognition.onend = () => {
      setIsVoiceListening(false);
      if (!voiceShouldListenRef.current) {
        setIsVoiceCommandActive(false);
        return;
      }

      if (voiceRestartTimerRef.current) {
        window.clearTimeout(voiceRestartTimerRef.current);
      }
      voiceRestartTimerRef.current = window.setTimeout(() => {
        if (!voiceShouldListenRef.current || voiceRecognitionRef.current !== recognition) return;
        try {
          recognition.start();
        } catch {
          // The browser can briefly reject restarts while it settles; the next stop/start click will recover it.
        }
      }, 220);
    };

    voiceRecognitionRef.current = recognition;

    return () => {
      voiceShouldListenRef.current = false;
      setIsVoiceCommandActive(false);
      if (voiceRestartTimerRef.current) {
        window.clearTimeout(voiceRestartTimerRef.current);
        voiceRestartTimerRef.current = null;
      }
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      voiceRecognitionRef.current = null;
      setIsVoiceListening(false);
    };
  }, []);

  useEffect(() => {
    loadOrders();
    loadComplaints();
    loadWallet();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setExpandedOrders({});
      setShowMainMenu(false);
      setShowMenuOrders(false);
    }
  }, [user]);

  useEffect(() => {
    if (!showFreshnessChecker) {
      stopFreshnessCamera();
    }
  }, [showFreshnessChecker]);

  useEffect(() => () => stopFreshnessCamera(), []);

  useEffect(() => () => stopGestureCamera(), []);

  useEffect(() => {
    const video = gestureVideoRef.current;
    const stream = gestureStreamRef.current;
    if (!gestureCameraOn || !video || !stream) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.play().catch(() => {
      setGestureStatus("Tap Start Gestures again if the camera preview does not resume.");
    });
  }, [gestureCameraOn, showFarmAssistant]);

  useEffect(() => {
    if (!showMainMenu) return undefined;
    const closeMenuOnScroll = () => setShowMainMenu(false);
    window.addEventListener("scroll", closeMenuOnScroll, { passive: true });
    return () => window.removeEventListener("scroll", closeMenuOnScroll);
  }, [showMainMenu]);

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
            <img src={logoUrl} alt="My Farms logo" className="brand-logo" />
          </div>
          <div className="nav-actions" id="navActions">
            {user ? (
              <div className="nav-user-block">
                <span className="small muted nav-welcome">Hi {user.name}, thanks for choosing My Farms</span>
              </div>
            ) : (
              <>
                <a className="btn-ghost link-btn" href={aboutUrl}>
                  About Us
                </a>
                <button className="btn-primary" onClick={() => setShowAuth(true)}>
                  Login / Signup
                </button>
              </>
            )}
            {user ? (
              <div className="menu-shell">
                <button
                  className={`hamburger-btn ${showMainMenu ? "active" : ""}`}
                  type="button"
                  aria-label="Open customer menu"
                  aria-expanded={showMainMenu}
                  onClick={() => setShowMainMenu((v) => !v)}
                >
                  <span />
                  <span />
                  <span />
                </button>
                {showMainMenu ? (
                  <div className="account-menu">
                  <div className="account-menu-head">
                    <div>
                      <strong>My Farms Dashboard</strong>
                    </div>
                  </div>
                  <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowProfile(true);
                          setShowMainMenu(false);
                        }}
                      >
                        <span className="account-menu-label">
                          <span className="account-menu-icon" aria-hidden="true">
                            <img
                              src={menuIconUrl("profile.png")}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.parentElement.style.display = "none";
                              }}
                            />
                          </span>
                          Edit Profile
                        </span>
                      </button>
                      <button type="button" onClick={() => setShowMenuOrders((v) => !v)}>
                        <span className="account-menu-label">
                          <span className="account-menu-icon" aria-hidden="true">
                            <img
                              src={menuIconUrl("myorders.png")}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.parentElement.style.display = "none";
                              }}
                            />
                          </span>
                          My Orders
                        </span>
                        <span>{showMenuOrders ? "-" : "+"}</span>
                      </button>
                      {showMenuOrders ? (
                        <div className="account-submenu">
                          <button
                            type="button"
                            onClick={() => {
                              openAccountPanel("orders");
                          }}
                          >
                            <span className="account-menu-label">
                            <span className="account-menu-icon" aria-hidden="true">
                              <img
                                src={menuIconUrl("history.png")}
                                alt=""
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.parentElement.style.display = "none";
                                }}
                              />
                            </span>
                            View Order History
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                              openComplaintFlow();
                              setShowMainMenu(false);
                          }}
                        >
                          <span className="account-menu-label">
                            <span className="account-menu-icon" aria-hidden="true">
                              <img
                                src={menuIconUrl("orderissue.png")}
                                alt=""
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.parentElement.style.display = "none";
                                }}
                              />
                            </span>
                            Having issue with your current order?
                          </span>
                        </button>
                        <button
                          type="button"
                            onClick={() => {
                              openAccountPanel("complaints");
                          }}
                        >
                          <span className="account-menu-label">
                            <span className="account-menu-icon" aria-hidden="true">
                              <img
                                src={menuIconUrl("complain.png")}
                                alt=""
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.parentElement.style.display = "none";
                                }}
                              />
                            </span>
                            View My Complaints
                          </span>
                        </button>
                      </div>
                    ) : null}
                    <a href={aboutUrl}>
                      <span className="account-menu-label">
                        <span className="account-menu-icon" aria-hidden="true">
                          <img
                            src={menuIconUrl("aboutus.png")}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.parentElement.style.display = "none";
                            }}
                          />
                        </span>
                        About Us
                      </span>
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                          setShowMainMenu(false);
                          setShowWallet(true);
                          loadWallet();
                      }}
                    >
                      <span className="account-menu-label">
                        <span className="account-menu-icon" aria-hidden="true">
                          <img
                            src={menuIconUrl("wallet.png")}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.parentElement.style.display = "none";
                            }}
                          />
                        </span>
                        Wallet Coins
                      </span>
                      <span>{walletBalance}</span>
                    </button>
                    <button
                      type="button"
                        onClick={() => {
                          setShowMainMenu(false);
                          logoutUser("Logged out");
                      }}
                    >
                      <span className="account-menu-label">
                        <span className="account-menu-icon" aria-hidden="true">
                          <img
                            src={menuIconUrl("logout.png")}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.parentElement.style.display = "none";
                            }}
                          />
                        </span>
                        Logout
                      </span>
                    </button>
                  </>
                  </div>
                ) : null}
              </div>
            ) : null}
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
              <span>Get delivered within 15 hours</span>
              <span>Chemical-Free Priority</span>
              <span>From Trusted Farmers to your Home</span>
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
                    key={item.id || item.name}
                    className={`hero-produce-card hero-produce-card-${item.offset}`}
                    style={{ "--hero-accent": item.accent }}
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${item.name} details`}
                    onClick={() => openProductPreview(item.product)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openProductPreview(item.product);
                      }
                    }}
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
              <strong>No signature produce selected yet</strong>
              <p>Admins can mark products as Signature Produce in the admin portal to feature them here.</p>
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
          <div className="controls-main">
            <h2>Shop Products</h2>
            <div className="controls-right">
              <div className="search-with-voice">
                <input
                  id="productSearch"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={animatedSearchHint}
                />
                <button
                  className={`voice-search-btn ${isVoiceCommandActive || isVoiceListening ? "active" : ""}`}
                  type="button"
                  aria-label={isVoiceCommandActive || isVoiceListening ? "Stop voice search" : "Start voice search"}
                  title={isVoiceCommandActive || isVoiceListening ? "Stop voice search" : "Voice search"}
                  onClick={startVoiceSearch}
                  disabled={!voiceSupported}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 15a3.8 3.8 0 0 0 3.8-3.8V6.8a3.8 3.8 0 1 0-7.6 0v4.4A3.8 3.8 0 0 0 12 15Zm6.2-4a1 1 0 0 0-2 0 4.2 4.2 0 1 1-8.4 0 1 1 0 1 0-2 0A6.2 6.2 0 0 0 11 17.1V20H8.8a1 1 0 1 0 0 2h6.4a1 1 0 1 0 0-2H13v-2.9a6.2 6.2 0 0 0 5.2-6.1Z" />
                  </svg>
                </button>
              </div>
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
          </div>
          <div className="freshness-control-wrap">
            <button
              className="freshness-control"
              type="button"
              onClick={() => setShowFreshnessChecker(true)}
              aria-label="Check produce freshness"
            >
              <img src={mascotUrl} alt="" aria-hidden="true" />
              <span>Product</span>
              <strong>Freshness Lens</strong>
            </button>
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

          <aside className="cart-panel" ref={cartPanelRef}>
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

        <nav className="customer-app-nav" aria-label="Customer app navigation">
          <button type="button" onClick={() => handleCustomerAppNav("home")}>
            <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.5Z" />
            </svg>
            <span>Home</span>
          </button>
          <button type="button" onClick={() => handleCustomerAppNav("products")}>
            <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 8h14M6 8l1 12h10l1-12M9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
            <span>Products</span>
          </button>
          <button type="button" onClick={() => handleCustomerAppNav("cart")}>
            <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h2l2 10h9l2-7H7M9 20h.01M17 20h.01" />
            </svg>
            <span>Cart</span>
            {cartItemCount ? <strong className="app-nav-badge">{cartItemCount}</strong> : null}
          </button>
          <button type="button" onClick={() => handleCustomerAppNav("orders")}>
            <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h10v16H7zM9 8h6M9 12h6M9 16h4" />
            </svg>
            <span>Orders</span>
            {activeNavOrderCount ? <strong className="app-nav-badge">{activeNavOrderCount}</strong> : null}
          </button>
          <button type="button" onClick={() => handleCustomerAppNav("profile")}>
            <svg className="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21a7 7 0 0 1 14 0" />
            </svg>
            <span>Profile</span>
          </button>
        </nav>

      </main>

      {trackedOrders.length ? (
        <section className="order-tracker-dock" aria-label="Active order tracking">
          <div className="order-tracker-head">
            <div>
              <strong>Track Recent Active Orders</strong>
              <p className="order-tracker-note">
                Orders can be managed or canceled within 2 hours of placement. Delivered orders are available under order history.
              </p>
            </div>
            <button className="btn-ghost small" type="button" onClick={() => openAccountPanel("orders")}>
              View All
            </button>
          </div>
          <div className="order-tracker-list">
            {trackedOrders.map((order) => (
              <article className="order-tracker-card" key={`tracker-${order.id}`}>
                <div>
                  <strong>#{order.id.slice(-6).toUpperCase()}</strong>
                  {order.modifiedAt ? <span className="modified-pill">Modified</span> : null}
                </div>
                <span>{statusLabel(order.status)}</span>
                <small>Rs.{Number(order.totalAmount || 0).toFixed(2)}</small>
                {order.canManage ? (
                  <button className="btn-ghost small" type="button" onClick={() => openManageOrder(order)}>
                    Manage
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="brand-footer">
        <img src={logoUrl} alt="My Farms logo" />
        <div>
          <strong>My Farms</strong>
          <span>Fresh essentials, direct from local farms.</span>
        </div>
        <small>© {new Date().getFullYear()} My Farms</small>
      </footer>

      <div className="floating-mascot" aria-hidden="true">
        <img className="farmer-mascot-image" src={mascotUrl} alt="" />
      </div>

      <button
        className={`farm-assistant-launcher ${farmAssistantActive ? "is-active" : ""} ${cartItemCount ? "has-mobile-cart" : ""}`}
        type="button"
        onClick={() => setShowFarmAssistant(true)}
      >
        <img src={mascotUrl} alt="" aria-hidden="true" />
        <span>Farm Assistant</span>
        <span className="assistant-live-dot" aria-hidden="true" />
      </button>

      {showFarmAssistant ? (
        <aside className="assistant-dock" aria-label="Farm Assistant">
          <div className={`assistant-dock-card ${farmAssistantActive ? "is-active" : ""}`}>
            <button className="close-btn" onClick={() => setShowFarmAssistant(false)} aria-label="Close Farm Assistant">x</button>
            <p className="kicker">Farm Assistant</p>
            <h3>Shop with voice and gestures</h3>
            <p className="muted small">
              Say add milk, scroll down, show cart, show orders, checkout, or use gestures.
            </p>

            <div className="assistant-status">
              <strong>{isVoiceCommandActive || isVoiceListening ? "Listening..." : "Ready"}</strong>
              <span>{assistantTranscript || assistantMessage}</span>
            </div>

            <div className="assistant-actions">
              <button className="btn-primary" type="button" onClick={startVoiceSearch} disabled={!voiceSupported}>
                {isVoiceCommandActive || isVoiceListening ? "Stop Voice Command" : "Voice Command"}
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={gestureCameraOn ? stopGestureCamera : startGestureCamera}
                disabled={isGestureLoading}
              >
                {isGestureLoading ? "Starting..." : gestureCameraOn ? "Stop Gestures" : "Start Gestures"}
              </button>
            </div>

            <div className="gesture-panel">
              <div className="gesture-video-wrap">
                <video ref={gestureVideoRef} className="gesture-video" playsInline muted />
                {gestureCameraOn ? (
                  <div className="gesture-overlay" aria-live="polite">
                    <div>
                      <strong>{gestureDetected.label}</strong>
                      <small>{gestureDetected.action}</small>
                    </div>
                    <span>{gestureDetected.confidence ? `${gestureDetected.confidence}%` : "Hold steady"}</span>
                  </div>
                ) : null}
                {!gestureCameraOn ? (
                  <div className="gesture-empty">
                    <strong>Gesture camera</strong>
                    <span>Point over a product for a moment to add. Palm down. Fist up.</span>
                  </div>
                ) : null}
              </div>
              <div className="gesture-help">
                <span>{gestureStatus}</span>
                {gestureCameraOn ? (
                  <div className="gesture-guide-note">
                    <strong>Gesture guide</strong>
                    <small>Victory opens checkout. In checkout, hold Thumbs Up for Next. On Review, Thumbs Up asks for final confirmation.</small>
                  </div>
                ) : null}
                <div className="gesture-command-grid" aria-label="Gesture commands">
                  <span>Finger Hold: Add</span>
                  <span>Thumbs Down: Remove</span>
                  <span>Thumbs Up: Add / Next</span>
                  <span>Open Palm: Down</span>
                  <span>Fist: Up</span>
                  <span>Victory: Checkout</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      ) : null}

      {gestureCameraOn && !showFarmAssistant ? (
        <video
          ref={gestureVideoRef}
          className="gesture-processing-video"
          playsInline
          muted
          aria-hidden="true"
        />
      ) : null}

      {gestureCameraOn && gestureCursor.active ? (
        <div
          className={`gesture-screen-cursor ${gestureCursor.progress >= 100 ? "is-complete" : ""}`}
          style={{
            left: `${gestureCursor.x}px`,
            top: `${gestureCursor.y}px`,
            "--gesture-progress": `${gestureCursor.progress}%`
          }}
          aria-hidden="true"
        >
          <span />
          <small>{gestureCursor.label}</small>
        </div>
      ) : null}

      {showFreshnessChecker ? (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowFreshnessChecker(false);
          }}
        >
          <div className="modal-card freshness-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setShowFreshnessChecker(false)}>x</button>
            <p className="kicker">Freshness Checker</p>
            <h3>Scan products before you cook</h3>
            <p className="muted small">
              Point your camera at one supported fruit or vegetable in good light. Non-food items and unclear images
              will be rejected instead of rated. Tap the camera button when the product is centered.
            </p>

            <div className="freshness-grid">
              <div className="freshness-camera-panel">
                <video ref={freshnessVideoRef} className="freshness-video" playsInline muted />
                {!freshnessCameraOn ? (
                  <div className="freshness-empty">
                    <strong>Camera preview</strong>
                    <span>Use camera or upload an image</span>
                  </div>
                ) : null}
                {freshnessCameraOn ? (
                  <button
                    className="freshness-capture-btn"
                    type="button"
                    disabled={isFreshnessAnalyzing}
                    onClick={() => analyzeFreshnessImage(freshnessVideoRef.current)}
                    aria-label="Capture and check freshness"
                    title="Capture and check freshness"
                  >
                    <span />
                  </button>
                ) : null}
                <canvas ref={freshnessCanvasRef} className="freshness-canvas" aria-hidden="true" />
              </div>

              <div className="freshness-result-panel">
                {freshnessResult ? (
                  <>
                    <span className="freshness-score">{freshnessResult.score}%</span>
                    <h4>{freshnessResult.label}</h4>
                    <p>{freshnessResult.advice}</p>
                    <div className="freshness-meter">
                      <span style={{ width: `${freshnessResult.score}%` }} />
                    </div>
                    <small>
                      {freshnessResult.source === "roboflow" ? "Model" : "Local estimate"} confidence: {freshnessResult.confidence}%
                      {freshnessResult.detectedClass ? ` • Detected: ${freshnessResult.detectedClass}` : ""}
                    </small>
                  </>
                ) : (
                  <>
                    <span className="freshness-score muted">--</span>
                    <h4>Ready to scan</h4>
                    <p>Place the produce in the center of the frame and avoid harsh shadows.</p>
                  </>
                )}
              </div>
            </div>

            <div className="freshness-actions">
              <button className="btn-primary" type="button" onClick={startFreshnessCamera}>
                {freshnessCameraOn ? "Restart Camera" : "Start Camera"}
              </button>
              <label className="btn-ghost freshness-upload">
                Upload Photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFreshnessUpload(e.target.files && e.target.files[0])}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {showAppProfileMenu && user ? (
        <div
          className="modal app-profile-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAppProfileMenu(false);
          }}
        >
          <div className="modal-card app-profile-sheet" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setShowAppProfileMenu(false)}>x</button>
            <p className="kicker">My Farms</p>
            <h3>Hi {user.name}</h3>
            <p className="muted small">Manage your account, orders, support, and wallet.</p>
            <div className="app-profile-actions">
              <button
                type="button"
                onClick={() => {
                  openProfileTool(() => setShowProfile(true));
                }}
              >
                Edit Profile
              </button>
              <div className="app-profile-section-title">My Orders & Support</div>
              <div className="app-profile-subactions">
                <button
                  type="button"
                  onClick={() => {
                    openAccountPanel("orders", { returnToProfile: true });
                    setShowAppProfileMenu(false);
                  }}
                >
                  View Order History
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openProfileTool(openComplaintFlow);
                  }}
                >
                  Having issue with your current order?
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openAccountPanel("complaints", { returnToProfile: true });
                    setShowAppProfileMenu(false);
                  }}
                >
                  View My Complaints
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  openProfileTool(() => setShowWallet(true));
                }}
              >
                Wallet Coins
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = aboutUrl;
                }}
              >
                About Us
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setShowAppProfileMenu(false);
                  logoutUser();
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showWallet && user ? (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeProfileTool(() => setShowWallet(false));
          }}
        >
          <div className="modal-card wallet-modal" onClick={(e) => e.stopPropagation()}>
            {IS_NATIVE_APP && profileToolReturnToProfile ? (
              <button
                className="modal-back-btn"
                type="button"
                onClick={() => returnToProfileFromTool(() => setShowWallet(false))}
                aria-label="Back to profile tools"
              >
                &larr;
              </button>
            ) : null}
            <button className="close-btn" onClick={() => closeProfileTool(() => setShowWallet(false))}>x</button>
            <p className="kicker">My Farms Wallet</p>
            <h3>Your Coins</h3>
            <div className="wallet-balance-card">
              <span>Total Balance</span>
              <strong>{walletBalance} coins</strong>
              <p>Earn 2 coins for every Rs.100 spent. Redeem 50 coins for Rs.1 off.</p>
            </div>
            <div className="wallet-rate-grid">
              <div>
                <span>Earn Rate</span>
                <strong>0.02 coin / Rs.1</strong>
              </div>
              <div>
                <span>Redeem Value</span>
                <strong>50 coins = Rs.1</strong>
              </div>
            </div>
            <h4>Coins History</h4>
            <div className="wallet-history">
              {wallet.transactions.length ? (
                wallet.transactions.map((tx) => (
                  <div className="wallet-history-row" key={tx.id}>
                    <div>
                      <strong>{tx.description}</strong>
                      <span>{new Date(tx.createdAt).toLocaleString()}</span>
                    </div>
                    <div className={tx.type === "EARN" ? "wallet-positive" : "wallet-negative"}>
                      {tx.coins > 0 ? "+" : ""}{tx.coins}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted small">No wallet activity yet. Place an order to start earning coins.</p>
              )}
            </div>
          </div>
        </div>
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

                    const nextUser = data.user;
                    if (!nextUser) {
                      throw new Error("Email verified, but profile details could not be loaded. Please login again.");
                    }
                    setUser(nextUser);
                    setShowAuth(false);
                    setVerificationForm({ email: "", code: "", devCode: "" });
                    setAuthForm({ name: "", email: "", password: "" });
                    setShowAuthPassword(false);
                    setAuthMode("login");
                    setProfileForm({
                      name: nextUser.name || "",
                      email: nextUser.email || "",
                      mobileNumber: nextUser.mobileNumber || ""
                    });
                    setCheckout((prev) => ({
                      ...prev,
                      fullName: nextUser.name || "",
                      contactNumber: nextUser.mobileNumber || ""
                    }));
                    showToast(`Hi ${nextUser.name}, your email is verified`);
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
                      if (!authTermsAccepted) {
                        showToast("Please accept My Farms Terms and Conditions");
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
                      payload.termsAccepted = true;
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

                    const nextUser = data.user;
                    if (!nextUser) {
                      throw new Error("Login completed, but profile details could not be loaded. Please try again.");
                    }
                    setUser(nextUser);
                    setShowAuth(false);
                    setAuthForm({ name: "", email: "", password: "" });
                    setAuthTermsAccepted(false);
                    setShowAuthPassword(false);
                    setAuthMode("login");
                    setProfileForm({
                      name: nextUser.name || "",
                      email: nextUser.email || "",
                      mobileNumber: nextUser.mobileNumber || ""
                    });
                    setCheckout((prev) => ({
                      ...prev,
                      fullName: nextUser.name || "",
                      contactNumber: nextUser.mobileNumber || ""
                    }));
                    showToast(`Hi ${nextUser.name}, thanks for choosing My Farms`);
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
                {authMode === "signup" ? (
                  <label className="checkbox-inline terms-check">
                    <input
                      type="checkbox"
                      checked={authTermsAccepted}
                      onChange={(e) => setAuthTermsAccepted(e.target.checked)}
                      required
                    />
                    <span>
                      I agree to the{" "}
                      {IS_NATIVE_APP ? (
                        <button
                          className="terms-link-button"
                          type="button"
                          onClick={() => setShowTerms(true)}
                        >
                          My Farms Terms and Conditions
                        </button>
                      ) : (
                        <a href={termsUrl} target="_blank" rel="noreferrer">
                          My Farms Terms and Conditions
                        </a>
                      )}
                      .
                    </span>
                  </label>
                ) : null}
                <button className="btn-primary" type="submit" disabled={isAuthSubmitting}>
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
                    setAuthTermsAccepted(false);
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
            <button className="close-btn" onClick={closeCheckoutFlow}>x</button>
            <h3>Checkout</h3>
            <div className="checkout-steps">
              <button type="button" className={checkoutStep === 1 ? "active" : checkoutStep > 1 ? "complete" : ""} onClick={() => setCheckoutStep(1)}>
                <strong>1</strong>
                <span>Address</span>
              </button>
              <button
                type="button"
                className={checkoutStep === 2 ? "active" : checkoutStep > 2 ? "complete" : ""}
                onClick={() => {
                  if (canContinueCheckoutStep(1)) setCheckoutStep(2);
                }}
              >
                <strong>2</strong>
                <span>Payment</span>
              </button>
              <button
                type="button"
                className={checkoutStep === 3 ? "active" : ""}
                onClick={() => {
                  if (canContinueCheckoutStep(1) && canContinueCheckoutStep(2)) setCheckoutStep(3);
                }}
              >
                <strong>3</strong>
                <span>Review</span>
              </button>
            </div>
            {checkoutNotice ? (
              <div className="checkout-notice" role="alert">
                {checkoutNotice}
              </div>
            ) : null}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (checkoutStep < 3) {
                  goToNextCheckoutStep();
                  return;
                }
                if (canContinueCheckoutStep(1) && canContinueCheckoutStep(2)) {
                  await placeOrder();
                }
              }}
            >
              {checkoutStep === 1 ? (
                <section className="checkout-step-panel">
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
                    <label>Delivery Option</label>
                    <select
                      value={checkout.paymentMethod}
                      onChange={(e) => setCheckout((s) => ({ ...s, paymentMethod: e.target.value }))}
                      required
                    >
                      <option value="COD">Home Delivery</option>
                      <option value="PICKUP">Store Pickup</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Delivery Address</label>
                    <textarea
                      value={checkout.address}
                      onChange={(e) => setCheckout((s) => ({ ...s, address: e.target.value }))}
                      rows="3"
                      disabled={checkout.paymentMethod === "PICKUP"}
                      placeholder={checkout.paymentMethod === "PICKUP" ? "Store pickup selected" : "House no, street, area, city, pincode"}
                    />
                  </div>
                </section>
              ) : null}

              {checkoutStep === 2 ? (
                <section className="checkout-step-panel">
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
                      onChange={(e) => setCheckout((s) => ({ ...s, promoCode: sanitizePromoCode(e.target.value) }))}
                      type="text"
                      placeholder="Enter promo code"
                    />
                    <button className="btn-ghost" type="button" onClick={applyPromoCode}>Apply Promo</button>
                    <div className="small muted">
                      {promoPreview.message || "Promo will be validated at checkout"}
                    </div>
                  </div>
                  <label className="wallet-checkout-option">
                    <input
                      type="checkbox"
                      checked={checkout.useWalletCoins}
                      disabled={!walletBalance}
                      onChange={(e) => setCheckout((s) => ({ ...s, useWalletCoins: e.target.checked }))}
                    />
                    <span>
                      Use wallet coins
                      <small>
                        {walletBalance
                          ? `${walletBalance} coins available. This order can use ${walletCoinsUsedEstimate || Math.min(walletBalance, Math.floor(checkoutTotalBeforeWallet) * WALLET_COINS_PER_RUPEE)} coins for Rs.${walletRedeemEstimate || Math.min(walletDiscountCapacity, Math.floor(checkoutTotalBeforeWallet))} off.`
                          : "No wallet coins available yet."}
                      </small>
                    </span>
                  </label>
                </section>
              ) : null}

              {checkoutStep === 3 ? (
                <section className="checkout-step-panel">
                  <div className="checkout-review-box">
                    <strong>Delivery</strong>
                    <span>{checkout.fullName} | {checkout.contactNumber}</span>
                    <span>{checkout.paymentMethod === "PICKUP" ? "Store Pickup" : checkout.address}</span>
                  </div>
                  <div className="checkout-review-box">
                    <strong>Items</strong>
                    {cart.map((item) => (
                      <span key={`checkout-review-${item.key}`}>
                        {item.name}{item.variant ? ` (${item.variant})` : ""} x {item.quantity}
                      </span>
                    ))}
                  </div>
                  <div className="checkout-review-box">
                    <strong>Payment</strong>
                    <span>{checkout.paymentMethod === "COD" ? "Cash On Delivery" : "Store Pickup"}</span>
                    {promoPreview.valid ? <span>Promo: {promoPreview.code}</span> : null}
                    {checkout.useWalletCoins ? <span>Wallet discount: Rs.{walletRedeemEstimate.toFixed(2)}</span> : null}
                  </div>
                </section>
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
                  <span>Wallet Coins</span>
                  <strong>-Rs.{walletRedeemEstimate.toFixed(2)}</strong>
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
                <div className="wallet-earn-note">
                  You will earn {coinsEarnEstimate} coin{coinsEarnEstimate === 1 ? "" : "s"} from this order.
                </div>
              </div>
              <div className="checkout-actions">
                {checkoutStep > 1 ? (
                  <button className="btn-ghost" type="button" onClick={() => setCheckoutStep((step) => Math.max(step - 1, 1))}>
                    Back
                  </button>
                ) : null}
                <button className="btn-primary" type="submit" disabled={isPlacingOrder}>
                  {isPlacingOrder ? (
                    <span className="btn-loading">
                      <span className="spinner" />
                      Placing Order...
                    </span>
                  ) : checkoutStep < 3 ? (
                    "Next"
                  ) : (
                    "Place Order"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {pendingAssistantOrderConfirmation ? (
        <div className="assistant-confirm-overlay" role="presentation">
          <div className="assistant-confirm-card" role="dialog" aria-modal="true" aria-live="assertive" aria-label="Confirm order placement">
            <strong>Place this order?</strong>
            <span>Tap Yes to place order, or No to cancel. Voice users can also say yes or no.</span>
            <div>
              <button className="btn-primary small" type="button" onClick={confirmAssistantOrderPlacement}>
                Yes
              </button>
              <button className="btn-ghost small" type="button" onClick={cancelAssistantOrderPlacement}>
                No
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showTerms ? (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowTerms(false);
          }}
        >
          <div className="modal-card terms-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setShowTerms(false)}>x</button>
            <p className="kicker">My Farms</p>
            <h3>Terms and Conditions</h3>
            <p className="muted small">Last updated: July 2026</p>
            <p>
              By creating an account, you agree that My Farms may use your information to create and protect your
              account, process orders, coordinate delivery or pickup, contact you about service needs, and prevent
              misuse or unauthorized activity.
            </p>
            <div className="terms-retention-list">
              <div>
                <strong>Email, phone number, and profile name</strong>
                <span>Stored until you delete your account or ask us to remove it.</span>
              </div>
              <div>
                <strong>Delivery address and order contact details</strong>
                <span>Kept with order records for up to 6 months for support, delivery checks, and business records.</span>
              </div>
              <div>
                <strong>Active delivery tracking details</strong>
                <span>Shown while an order is active; delivered orders stay in the recent tracker for 48 hours.</span>
              </div>
              <div>
                <strong>Order history</strong>
                <span>Available for up to 6 months. Older order details may be removed from customer history.</span>
              </div>
              <div>
                <strong>Support complaints and proof photos</strong>
                <span>Used to resolve issues and normally retained for up to 30 days after resolution.</span>
              </div>
              <div>
                <strong>Emails and phone calls</strong>
                <span>We may email or call you for verification, order updates, delivery coordination, and support.</span>
              </div>
            </div>
            <p>
              Privacy Policy:{" "}
              <a href="https://myfarms.onrender.com/privacy-policy.html" target="_blank" rel="noreferrer">
                https://myfarms.onrender.com/privacy-policy.html
              </a>
            </p>
            <p>
              Account Deletion:{" "}
              <a href="https://myfarms.onrender.com/account-deletion.html" target="_blank" rel="noreferrer">
                https://myfarms.onrender.com/account-deletion.html
              </a>
            </p>
            <button className="btn-primary" type="button" onClick={() => setShowTerms(false)}>
              Done
            </button>
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

      {accountPanel ? (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAccountPanel();
          }}
        >
          <div className="modal-card account-panel-modal" onClick={(e) => e.stopPropagation()}>
            {IS_NATIVE_APP && accountPanelReturnToProfile ? (
              <button
                className="modal-back-btn"
                type="button"
                onClick={returnToProfileTools}
                aria-label="Back to profile tools"
              >
                &larr;
              </button>
            ) : null}
            <button className="close-btn" onClick={closeAccountPanel}>x</button>
            <p className="kicker">Customer Desk</p>
            <h3>{accountPanel === "orders" ? "Order History" : "My Complaints"}</h3>
            {!user ? (
              <p className="muted small">Login to view this section.</p>
            ) : accountPanel === "orders" ? (
              <div className="account-panel-list">
                {!orders.length ? (
                  <p className="muted small">No orders yet.</p>
                ) : (
                  orders.map((o) => (
                    <div className={`order-card ${isDeliveredStatus(o.status) ? "order-card-delivered" : "order-card-pending"}`} key={`panel-${o.id}`}>
                      <strong>Order #{o.id.slice(-6).toUpperCase()}</strong>
                      <div className="small muted">{new Date(o.createdAt).toLocaleString()}</div>
                      {o.modifiedAt ? (
                        <div className="small">
                          <span className="modified-pill">Modified</span> {new Date(o.modifiedAt).toLocaleString()}
                        </div>
                      ) : null}
                      <div className="small">
                        Status:{" "}
                        <span className={`order-status-pill ${isDeliveredStatus(o.status) ? "is-delivered" : "is-pending"}`}>
                          {statusLabel(o.status)}
                        </span>
                      </div>
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
                        {o.canManage ? (
                          <>
                            <button className="btn-ghost small" onClick={() => openManageOrder(o)}>Manage Order</button>
                            <button className="btn-ghost small danger" onClick={() => cancelCustomerOrder(o.id)}>Cancel Order</button>
                          </>
                        ) : null}
                        <button
                          className="btn-ghost small"
                          onClick={() => {
                            const shouldReturnToProfile = accountPanelReturnToProfile;
                            closeAccountPanel();
                            setProfileToolReturnToProfile(shouldReturnToProfile);
                            setComplaintForm((s) => ({
                              ...s,
                              orderNumber: s.orderNumber || `#${o.id.slice(-6).toUpperCase()}`
                            }));
                            setShowComplaint(true);
                          }}
                        >
                          Report Issue
                        </button>
                      </div>
                      {expandedOrders[o.id] ? (
                        <div className="order-items-preview">
                          <div className="small order-items-title">Items in this order</div>
                          {(o.items || []).length ? (
                            <div className="order-items-list">
                              {(o.items || []).map((item, index) => (
                                <div className="order-item-row" key={`panel-${o.id}-${item.productId}-${item.variantName || "base"}-${index}`}>
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
            ) : (
              <div className="account-panel-list">
                {!complaints.length ? (
                  <p className="muted small">No complaints yet.</p>
                ) : (
                  complaints.map((c) => (
                    <div className="order-card" key={`panel-${c.id}`}>
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
            )}
          </div>
        </div>
      ) : null}

      {managingOrder ? (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setManagingOrder(null);
          }}
        >
          <div className="modal-card manage-order-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setManagingOrder(null)}>x</button>
            <p className="kicker">Manage Order</p>
            <h3>Order #{managingOrder.id.slice(-6).toUpperCase()}</h3>
            <p className="muted small">
              Available until{" "}
              {managingOrder.manageExpiresAt
                ? new Date(managingOrder.manageExpiresAt).toLocaleString()
                : "the manage window closes"}
              .
            </p>

            <div className="manage-order-list">
              {(managingOrder.editItems || []).length ? (
                managingOrder.editItems.map((item, index) => (
                  <div
                    className="manage-order-row"
                    key={`manage-${item.productId}-${item.variantName || "base"}-${index}`}
                  >
                    <div>
                      <strong>{item.productName}</strong>
                      {item.variantName ? <div className="small muted">{item.variantName}</div> : null}
                    </div>
                    <div className="qty-controls">
                      <button type="button" onClick={() => updateManagingOrderQuantity(index, -1)}>-</button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => updateManagingOrderQuantity(index, 1)}>+</button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted small">No items selected.</p>
              )}
            </div>

            <div className="manage-order-actions">
              <button className="btn-ghost" type="button" onClick={addCartToManagingOrder}>
                Add Current Cart Items
              </button>
              <button className="btn-ghost danger" type="button" onClick={() => cancelCustomerOrder(managingOrder.id)}>
                Cancel Order
              </button>
              <button className="btn-primary" type="button" onClick={saveManagedOrder}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showProfile && user ? (
        <div className="modal">
          <div className="modal-card">
            {IS_NATIVE_APP && profileToolReturnToProfile ? (
              <button
                className="modal-back-btn"
                type="button"
                onClick={() => returnToProfileFromTool(() => setShowProfile(false))}
                aria-label="Back to profile tools"
              >
                &larr;
              </button>
            ) : null}
            <button className="close-btn" onClick={() => closeProfileTool(() => setShowProfile(false))}>x</button>
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
                  closeProfileTool(() => setShowProfile(false));
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
                    closeProfileTool(() => setShowProfile(false));
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
            {IS_NATIVE_APP && profileToolReturnToProfile ? (
              <button
                className="modal-back-btn"
                type="button"
                onClick={() => returnToProfileFromTool(() => setShowComplaint(false))}
                aria-label="Back to profile tools"
              >
                &larr;
              </button>
            ) : null}
            <button className="close-btn" onClick={() => closeProfileTool(() => setShowComplaint(false))}>x</button>
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
                  closeProfileTool(() => setShowComplaint(false));
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
                <div className="proof-photo-actions">
                  <label className="btn-ghost proof-photo-btn">
                    Take Photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                        setComplaintForm((s) => ({ ...s, proofImage: file }));
                      }}
                    />
                  </label>
                  <label className="btn-ghost proof-photo-btn">
                    Choose from Gallery
                    <input
                      type="file"
                      accept="image/*,.png,.jpg,.jpeg,.webp"
                      onChange={(e) => {
                        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                        setComplaintForm((s) => ({ ...s, proofImage: file }));
                      }}
                    />
                  </label>
                </div>
                {complaintForm.proofImage ? (
                  <div className="small muted">Selected: {complaintForm.proofImage.name}</div>
                ) : null}
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
