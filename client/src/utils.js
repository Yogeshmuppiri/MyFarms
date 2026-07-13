import { Capacitor } from "@capacitor/core";

const DEFAULT_NATIVE_API_BASE_URL = "https://myfarms.onrender.com";
const isNativeApp = Capacitor.isNativePlatform();
const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || (isNativeApp ? DEFAULT_NATIVE_API_BASE_URL : "")
).replace(/\/+$/, "");

function withApiBase(path) {
  const raw = String(path || "");
  if (!API_BASE_URL || /^https?:\/\//i.test(raw)) return raw;
  return `${API_BASE_URL}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export function resolveSiteUrl(path) {
  return withApiBase(path);
}

export async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(withApiBase(path), {
    headers,
    credentials: "include",
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

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export function isAllowedCustomerEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!isValidEmail(normalized)) return false;
  const domain = normalized.split("@")[1] || "";
  return domain === "gmail.com" || domain === "yahoo.com";
}

export function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const VOICE_PRODUCT_STOP_WORDS = new Set([
  "add",
  "buy",
  "get",
  "put",
  "remove",
  "delete",
  "drop",
  "take",
  "out",
  "from",
  "place",
  "please",
  "to",
  "into",
  "in",
  "cart",
  "basket",
  "show",
  "search",
  "find",
  "for",
  "product",
  "products",
  "item",
  "items",
  "the",
  "a",
  "an",
  "some",
  "one",
  "two",
  "three",
  "1",
  "2",
  "3",
  "kg",
  "kilo",
  "kilos",
  "liter",
  "litre",
  "liters",
  "litres",
  "dozen",
  "pack",
  "piece",
  "pieces",
  "of",
  "me",
  "my"
]);

export function tokenizeSpeechProduct(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part && !VOICE_PRODUCT_STOP_WORDS.has(part));
}

export function getSpeechProductText(value) {
  return tokenizeSpeechProduct(value).join(" ");
}

export function sanitizePromoCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseSpokenNumber(value) {
  const raw = String(value || "").toLowerCase();
  const digitMatch = raw.match(/\d+/);
  if (digitMatch) return Number(digitMatch[0]);

  const words = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100
  };

  let total = 0;
  let current = 0;
  for (const part of raw.split(/[^a-z]+/).filter(Boolean)) {
    if (!(part in words)) continue;
    const number = words[part];
    if (number === 100) current = Math.max(1, current) * 100;
    else current += number;
  }
  total += current;
  return total || null;
}

export function scoreSpeechProductMatch(product, queryTokens, queryToken) {
  const nameTokens = String(product?.name || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const nameToken = normalizeToken(product?.name);
  if (!nameToken || !queryToken) return 0;

  let score = 0;
  if (nameToken === queryToken) score += 120;
  if (nameToken.includes(queryToken) || queryToken.includes(nameToken)) score += 90;

  for (const token of queryTokens) {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    for (const namePart of nameTokens) {
      const nameSingular = namePart.endsWith("s") ? namePart.slice(0, -1) : namePart;
      if (namePart === token || nameSingular === singular) score += 40;
      else if (namePart.startsWith(token) || token.startsWith(namePart)) score += 18;
    }
  }

  return score;
}

export function resolveAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return withApiBase(`/resources/${encodeURIComponent(raw)}`);
}

export function getProductImagePath(productName, files) {
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

  return bestFile ? withApiBase(`/resources/${encodeURIComponent(bestFile)}`) : "";
}

export function statusLabel(status) {
  if (status === "ASSIGNED") return "Assigned";
  if (status === "ACCEPTED_BY_DELIVERY") return "Accepted by Delivery";
  if (status === "OUT_FOR_DELIVERY") return "Out for Delivery";
  if (status === "ORDER_READY_FOR_PICKUP") return "Order Ready for Pickup";
  if (status === "CANCELED") return "Canceled";
  if (status === "DELIVERED") return "Delivered";
  return status || "Placed";
}

export function isDeliveredStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized.includes("DELIVERED");
}

export function getShowcaseAccent(category) {
  const key = String(category || "").trim().toLowerCase();
  if (key.includes("dairy")) return "#d9efe8";
  if (key.includes("oil")) return "#f0d1a0";
  if (key.includes("honey")) return "#f3d08d";
  if (key.includes("egg")) return "#f6e3b7";
  if (key.includes("fruit")) return "#f7d6b6";
  if (key.includes("vegetable")) return "#d7edc5";
  return "#f5e6b7";
}
