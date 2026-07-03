require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const MongoStoreModule = require("connect-mongo");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { initDb, models } = require("./db");
const orderLogic = require("./orderLogic");
const {
  sendOrderEmail,
  sendCustomerOrderEmail,
  sendPasswordResetEmail,
  sendOrderStatusEmail,
  sendComplaintCreatedEmails,
  sendComplaintClosedEmail,
  sendEmailVerificationEmail,
  sendWelcomeEmail,
  sendAdministrativeEmployeeWelcomeEmail,
  sendDeliveryAssignmentEmail,
  hasSmtpConfig
} = require("./mailer");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");
const reactDistDir = path.join(__dirname, "..", "client", "dist");
const reactIndexPath = path.join(reactDistDir, "index.html");
const resourceDir = path.join(__dirname, "..", "src", "main", "resources");
fs.mkdirSync(resourceDir, { recursive: true });
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const TAX_RATE = 0.05;
const ORDER_RETENTION_DAYS = 60;
const COMPLAINT_RETENTION_DAYS = 30;
const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MS || 1000 * 60 * 10);
const MongoStore = MongoStoreModule && MongoStoreModule.default ? MongoStoreModule.default : MongoStoreModule;
const ADMIN_PERMISSIONS = [
  { key: "alerts", label: "New Order Alerts" },
  { key: "dashboard", label: "Dashboard" },
  { key: "promos", label: "Promo Management" },
  { key: "products", label: "Product Management" },
  { key: "stock", label: "Stock Control" },
  { key: "orders", label: "Orders" },
  { key: "delivery_assign", label: "Delivery Assignment" },
  { key: "delivery_agent", label: "Delivery Agent Portal" },
  { key: "complaints", label: "Customer Complaints" },
  { key: "administration", label: "Administration" }
];
const ADMIN_PERMISSION_KEYS = ADMIN_PERMISSIONS.map((p) => p.key);
const DELIVERY_ASSIGNMENT_ROLES = new Set(["Inventory Associate", "Operations Manager", "Admin Assistant"]);

const hasCloudinaryConfig = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

// Render/other PaaS terminate HTTPS at a reverse proxy.
// Trust first proxy so secure session cookies are set correctly in production.
app.set("trust proxy", 1);

if (hasCloudinaryConfig) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

app.use(express.json({ limit: "8mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "myfarms_dev_secret",
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/myfarms",
      collectionName: "sessions",
      ttl: 60 * 60 * 24
    }),
    rolling: true,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: String(process.env.NODE_ENV || "").toLowerCase() === "production",
      maxAge: SESSION_IDLE_MS
    }
  })
);

app.use((req, _res, next) => {
  if (!req.session) return next();
  const now = Date.now();
  const lastActivityAt = Number(req.session.lastActivityAt || now);
  const isAuthed = Boolean(req.session.user || req.session.admin);

  if (isAuthed && now - lastActivityAt > SESSION_IDLE_MS) {
    req.session.user = null;
    req.session.admin = null;
  }

  req.session.lastActivityAt = now;
  next();
});

app.use(express.static(publicDir, { index: false }));
app.use(express.static(reactDistDir));
app.use("/resources", express.static(resourceDir));

function toSafeBaseName(fileName, fallback = "file") {
  const ext = path.extname(fileName || "").toLowerCase();
  const base = path
    .basename(fileName || fallback, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || fallback;
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

async function uploadBufferToCloudinary(file, folder = "myfarms") {
  const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
  const publicId = `${toSafeBaseName(file.originalname, "upload")}-${Date.now()}`;
  const dataUri = `data:${file.mimetype || "image/jpeg"};base64,${file.buffer.toString("base64")}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    public_id: publicId,
    overwrite: false,
    resource_type: "image"
  });

  return result.secure_url;
}

async function persistUpload(file, { folder = "myfarms", localPrefix = "upload" } = {}) {
  if (!file) return null;

  if (hasCloudinaryConfig) {
    return uploadBufferToCloudinary(file, folder);
  }

  const ext = path.extname(file.originalname || "").toLowerCase();
  const localName = `${toSafeBaseName(file.originalname, localPrefix)}-${Date.now()}${ext}`;
  const localPath = path.join(resourceDir, localName);
  await fs.promises.writeFile(localPath, file.buffer);
  return localName;
}

function createImageUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        return cb(new Error("Only png, jpg, jpeg, and webp images are allowed"));
      }
      cb(null, true);
    }
  });
}

const uploadImage = createImageUpload();
const uploadComplaintImage = createImageUpload();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ error: "Admin authentication required" });
  }
  next();
}

function hasAdminPermission(admin, permission) {
  if (!permission) return true;
  if (admin?.isOwner) return true;
  return Array.isArray(admin?.permissions) && admin.permissions.includes(permission);
}

function requireAdminPermission(permission) {
  return (req, res, next) => {
    if (!req.session.admin) {
      return res.status(401).json({ error: "Admin authentication required" });
    }
    if (!hasAdminPermission(req.session.admin, permission)) {
      return res.status(403).json({ error: "You do not have access to this admin feature" });
    }
    next();
  };
}

function requireAnyAdminPermission(permissions) {
  return (req, res, next) => {
    if (!req.session.admin) {
      return res.status(401).json({ error: "Admin authentication required" });
    }
    if (req.session.admin?.isOwner || permissions.some((permission) => hasAdminPermission(req.session.admin, permission))) {
      return next();
    }
    return res.status(403).json({ error: "You do not have access to this admin feature" });
  };
}

function runInBackground(task, label) {
  setImmediate(async () => {
    try {
      await task();
    } catch (err) {
      console.error(`${label}:`, err && err.message ? err.message : err);
    }
  });
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isAllowedCustomerEmailDomain(email) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return false;
  const domain = normalized.split("@")[1] || "";
  return domain === "gmail.com" || domain === "yahoo.com";
}

function isAllowedEmployeeEmailDomain(email) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return false;
  return (normalized.split("@")[1] || "") === "gmail.com";
}

function createEmailVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashVerificationCode(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

function isUserEmailVerified(user) {
  return user?.isEmailVerified !== false;
}

function getSessionUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    mobileNumber: user.mobileNumber || "",
    isEmailVerified: isUserEmailVerified(user),
    walletCoins: Math.max(0, Math.floor(Number(user.walletCoins || 0)))
  };
}

function calculateEarnedCoins(amount) {
  return orderLogic.calculateEarnedCoins(amount);
}

function calculateWalletDiscountFromCoins(coins) {
  return orderLogic.calculateWalletDiscountFromCoins(coins);
}

async function issueEmailVerificationForUser(user) {
  const verificationCode = createEmailVerificationCode();
  user.isEmailVerified = false;
  user.emailVerificationCodeHash = hashVerificationCode(verificationCode);
  user.emailVerificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await user.save();
  return verificationCode;
}

function isValidContactNumber(contactNumber) {
  return orderLogic.isValidContactNumber(contactNumber);
}

function isValidMobileNumber(mobileNumber) {
  if (mobileNumber === null || mobileNumber === undefined || String(mobileNumber).trim() === "") return true;
  return /^\d{10}$/.test(String(mobileNumber).trim());
}

function isValidAadhaarNumber(aadhaarNumber) {
  return /^\d{12}$/.test(String(aadhaarNumber || "").replace(/\D/g, ""));
}

function normalizeAadhaarNumber(aadhaarNumber) {
  return String(aadhaarNumber || "").replace(/\D/g, "");
}

function hashAadhaarNumber(aadhaarNumber) {
  const secret = process.env.SESSION_SECRET || "myfarms_dev_secret";
  return crypto.createHash("sha256").update(`${secret}:${normalizeAadhaarNumber(aadhaarNumber)}`).digest("hex");
}

function normalizeAdminPermissions(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return [...new Set(raw.filter((permission) => ADMIN_PERMISSION_KEYS.includes(permission)))];
}

function canRoleAssignDeliveries(role) {
  return DELIVERY_ASSIGNMENT_ROLES.has(String(role || "").trim());
}

function serializeAdministrativeEmployee(employee) {
  return {
    id: String(employee._id),
    name: employee.name,
    email: employee.email,
    phoneNumber: employee.phoneNumber,
    dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.toISOString().slice(0, 10) : "",
    role: employee.role,
    employeePhotoPath: employee.employeePhotoPath || null,
    aadhaarLast4: employee.aadhaarLast4,
    permissions: normalizeAdminPermissions(employee.permissions || []),
    active: employee.active !== false,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt
  };
}

function getAdminActorLabel(admin) {
  if (!admin) return "Admin";
  return admin.name || admin.email || "Admin";
}

function serializeDeliveryEmployee(employee) {
  if (!employee) return null;
  return {
    id: String(employee._id),
    name: employee.name,
    email: employee.email,
    phoneNumber: employee.phoneNumber,
    role: employee.role,
    employeePhotoPath: employee.employeePhotoPath || null,
    active: employee.active !== false
  };
}

function serializeOrderDelivery(o) {
  const employee = o.deliveryEmployeeId && typeof o.deliveryEmployeeId === "object"
    ? serializeDeliveryEmployee(o.deliveryEmployeeId)
    : null;
  return {
    employee,
    assignedBy: o.deliveryAssignedBy || null,
    assignedAt: o.deliveryAssignedAt || null,
    acceptedAt: o.deliveryAcceptedAt || null,
    completedAt: o.deliveryCompletedAt || null,
    canceledAt: o.deliveryCanceledAt || null,
    cancelNote: o.deliveryCancelNote || null
  };
}

function normalizeFreshnessPrediction(prediction) {
  const className = String(prediction?.class || prediction?.class_name || prediction?.label || "").toLowerCase();
  const confidence = Math.max(0, Math.min(1, Number(prediction?.confidence || prediction?.score || 0)));

  let condition = "unknown";
  if (
    className.includes("rotten") ||
    className.includes("spoiled") ||
    className.includes("stale") ||
    className.includes("mold") ||
    className.includes("decay") ||
    className.includes("bad")
  ) {
    condition = "rotten";
  } else if (
    className.includes("fresh") ||
    className.includes("healthy") ||
    className.includes("good") ||
    (className.includes("ripe") && !className.includes("unripe") && !className.includes("overripe"))
  ) {
    condition = "fresh";
  }

  return {
    className: String(prediction?.class || prediction?.class_name || prediction?.label || "Produce"),
    condition,
    confidence
  };
}

function getBase64ImagePayload(imageDataUrl) {
  return String(imageDataUrl || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
}

function normalizeRoboflowModelId(value) {
  return String(value || "")
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .replace(/\s+/g, "");
}

function getRoboflowModelIds(value) {
  const configured = String(value || "")
    .split(",")
    .map(normalizeRoboflowModelId)
    .filter(Boolean);
  const candidates = [
    ...configured,
    "fruits-fresh-and-rotten-rkl2w/1",
    "freshness-fruits-and-vegetables-p8g5m/1",
    "freshness-fruits-and-vegetables-worff/1",
    "freshness-fruits-and-vegetables/1"
  ];
  return [...new Set(candidates)];
}

function normalizeRoboflowApiBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  return raw || "https://serverless.roboflow.com";
}

function getRoboflowFallbackBaseUrls(apiBaseUrl) {
  const urls = [
    apiBaseUrl,
    "https://serverless.roboflow.com",
    "https://detect.roboflow.com",
    "https://classify.roboflow.com"
  ];
  return [...new Set(urls.filter(Boolean))];
}

function extractRoboflowPredictionArrays(value, output = []) {
  if (!value || typeof value !== "object") return output;

  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && ("class" in item || "class_name" in item || "label" in item))) {
      output.push(value);
    }
    value.forEach((item) => extractRoboflowPredictionArrays(item, output));
    return output;
  }

  if (Array.isArray(value.predictions)) {
    output.push(value.predictions);
  }

  Object.values(value).forEach((item) => extractRoboflowPredictionArrays(item, output));
  return output;
}

function getRoboflowPredictions(data) {
  if (Array.isArray(data?.predictions)) return data.predictions;

  if (data?.predictions && typeof data.predictions === "object") {
    return Object.entries(data.predictions).map(([className, value]) => ({
      class: className,
      confidence: Number(value?.confidence || value || 0)
    }));
  }

  if (data?.top) {
    return [{ class: data.top, confidence: Number(data.confidence || 0) }];
  }

  const nested = extractRoboflowPredictionArrays(data);
  if (nested.length) return nested.flat();

  return [];
}

function hasProduceKeyword(className) {
  const normalized = String(className || "").toLowerCase();
  const produceKeywords = [
    "apple",
    "banana",
    "orange",
    "mango",
    "tomato",
    "potato",
    "onion",
    "carrot",
    "cucumber",
    "pepper",
    "chilli",
    "chili",
    "brinjal",
    "eggplant",
    "cabbage",
    "cauliflower",
    "beet",
    "beetroot",
    "papaya",
    "pear",
    "watermelon",
    "grape",
    "lemon",
    "lime",
    "fruit",
    "vegetable"
  ];
  return produceKeywords.some((keyword) => normalized.includes(keyword));
}

function summarizeFreshnessPredictions(predictions) {
  const normalized = (predictions || [])
    .map(normalizeFreshnessPrediction)
    .filter((p) => p.condition !== "unknown" && p.confidence > 0);

  if (!normalized.length) {
    return {
      label: "Could not confirm freshness",
      advice: "Try again with one fruit or vegetable centered in good light",
      score: 0,
      confidence: 0,
      source: "roboflow",
      detectedClass: null,
      predictions: []
    };
  }

  normalized.sort((a, b) => b.confidence - a.confidence);
  const top = normalized[0];
  const hasProduceClass = hasProduceKeyword(top.className);
  const minConfidence = hasProduceClass ? 0.72 : 0.92;

  if (top.confidence < minConfidence) {
    return {
      label: "Could not confirm freshness",
      advice: "Try again with one fruit or vegetable centered in good light",
      score: 0,
      confidence: Math.round(top.confidence * 100),
      source: "roboflow",
      detectedClass: top.className,
      predictions: normalized.slice(0, 5)
    };
  }

  const confidencePercent = Math.round(top.confidence * 100);
  const score = top.condition === "fresh"
    ? Math.max(68, Math.min(98, confidencePercent))
    : Math.max(8, Math.min(48, 100 - confidencePercent));

  let label = "Looks fresh";
  let advice = "Good for today";
  if (top.condition === "rotten") {
    label = "May be overripe";
    advice = "Do not use unless you inspect it carefully";
  } else if (confidencePercent < 72) {
    label = "Use within 1-2 days";
    advice = "The item appears usable, but freshness confidence is moderate";
  } else if (confidencePercent < 86) {
    label = "Good for today";
    advice = "Best used soon for top taste";
  }

  return {
    label,
    advice,
    score,
    confidence: confidencePercent,
    source: "roboflow",
    detectedClass: top.className,
    predictions: normalized.slice(0, 5)
  };
}

function getFreshnessResultQuality(result) {
  if (!result) return 0;
  const hasCondition = result.score > 0 && result.detectedClass;
  const predictionCount = Array.isArray(result.predictions) ? result.predictions.length : 0;
  return (
    (hasCondition ? 1000 : 0) +
    Number(result.confidence || 0) +
    predictionCount * 2
  );
}

function normalizeProductDescription(value) {
  return String(value || "").trim();
}

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function isProductOutOfStock(product) {
  if (!product) return true;
  if (product.forceOutOfStock) return true;
  if (product.variants && product.variants.length) {
    return !product.variants.some((v) => Number(v.stock || 0) > 0);
  }
  return Number(product.stock || 0) <= 0;
}

async function cleanupOldOrders() {
  const cutoff = new Date(Date.now() - ORDER_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await models.Order.deleteMany({ createdAt: { $lt: cutoff } });
}

async function cleanupOldComplaints() {
  const cutoff = new Date(Date.now() - COMPLAINT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await models.Complaint.deleteMany({ createdAt: { $lt: cutoff } });
}

function buildComplaintTimeline(c) {
  const timeline = [{ key: "OPENED", label: "Opened", at: c.createdAt }];
  if (c.repliedAt) timeline.push({ key: "REPLIED", label: "Replied", at: c.repliedAt });
  if (c.closedAt) timeline.push({ key: "CLOSED", label: "Closed", at: c.closedAt });
  return timeline;
}

function createBadRequestError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

async function validatePromoCode({ promoCode, subtotalAmount }) {
  const code = String(promoCode || "").trim().toUpperCase();
  if (!code) {
    return { promo: null, discountAmount: 0 };
  }

  const promo = await models.PromoCode.findOne({ code, active: true });
  if (!promo) {
    throw createBadRequestError("Invalid promo code");
  }

  if (promo.expiresAt <= new Date()) {
    throw createBadRequestError("Promo code has expired");
  }

  if (promo.usedCount >= promo.maxUses) {
    throw createBadRequestError("Promo usage limit reached");
  }

  if (subtotalAmount < promo.minOrderValue) {
    throw createBadRequestError(`Minimum order value for this promo is Rs.${promo.minOrderValue}`);
  }

  const discountAmount = Number(((subtotalAmount * promo.discountPercent) / 100).toFixed(2));
  return { promo, discountAmount };
}

async function callRoboflowModel({ apiBaseUrl, modelId, apiKey, image }) {
  const endpoint = `${apiBaseUrl}/${modelId}?api_key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: getBase64ImagePayload(image)
    }),
    15000,
    "Roboflow freshness check"
  );
  const data = await response.json().catch(() => ({}));
  return { response, data, endpoint };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "my-farms" });
});

app.get("/api/resources/images", (_req, res) => {
  const files = fs
    .readdirSync(resourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ALLOWED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);

  res.json({ files });
});

app.get("/api/freshness/config", (_req, res) => {
  const apiKey = String(process.env.ROBOFLOW_API_KEY || "").trim();
  const configuredModelIds = getRoboflowModelIds(process.env.ROBOFLOW_FRESHNESS_MODEL);
  const apiBaseUrl = normalizeRoboflowApiBaseUrl(process.env.ROBOFLOW_API_URL);

  res.json({
    configured: Boolean(apiKey && configuredModelIds.length),
    hasApiKey: Boolean(apiKey),
    modelIds: configuredModelIds.map((id) => id.replace(/^[^/]+/, (project) => project)),
    apiBaseUrl,
    fallbackBaseUrls: getRoboflowFallbackBaseUrls(apiBaseUrl)
  });
});

app.post("/api/freshness/check", async (req, res) => {
  try {
    const apiKey = String(process.env.ROBOFLOW_API_KEY || "").trim();
    const modelIds = getRoboflowModelIds(process.env.ROBOFLOW_FRESHNESS_MODEL || "fruits-fresh-and-rotten-rkl2w/1");
    const apiBaseUrl = normalizeRoboflowApiBaseUrl(process.env.ROBOFLOW_API_URL);
    const image = String(req.body.image || "").trim();

    if (!apiKey) {
      return res.status(503).json({ error: "Freshness model is not configured" });
    }
    if (!modelIds.length || modelIds.some((modelId) => !/^[a-z0-9][a-z0-9-_/]*\/\d+$/i.test(modelId))) {
      return res.status(503).json({ error: "Freshness model id is invalid" });
    }
    if (!image || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Image data is required" });
    }

    let response;
    let data;
    let endpoint;
    let successfulModelId = null;
    let bestFreshnessResult = null;
    let bestRawModel = null;
    let bestQuality = 0;
    const failures = [];
    for (const modelId of modelIds) {
      for (const baseUrl of getRoboflowFallbackBaseUrls(apiBaseUrl)) {
        const result = await callRoboflowModel({ apiBaseUrl: baseUrl, modelId, apiKey, image });
        response = result.response;
        data = result.data;
        endpoint = result.endpoint;
        if (response.ok) {
          const freshnessResult = summarizeFreshnessPredictions(getRoboflowPredictions(data));
          const quality = getFreshnessResultQuality(freshnessResult);
          if (quality > bestQuality) {
            bestQuality = quality;
            bestFreshnessResult = freshnessResult;
            bestRawModel = {
              image: data.image || null,
              modelId,
              endpointType: new URL(endpoint).hostname
            };
          }
          if (freshnessResult.score > 0 && freshnessResult.detectedClass) {
            successfulModelId = modelId;
            break;
          }
          failures.push({
            modelId,
            status: response.status,
            endpoint: endpoint.replace(apiKey, "***"),
            error: "Model returned no usable fresh/rotten prediction"
          });
          continue;
        }
        failures.push({
          modelId,
          status: response.status,
          endpoint: endpoint.replace(apiKey, "***"),
          error: data?.error || data?.message || response.statusText
        });
      }
      if (successfulModelId) break;
    }

    if (!response?.ok && !bestFreshnessResult) {
      console.error("Roboflow freshness error:", {
        modelIds,
        failures
      });
      return res.status(502).json({
        error: "Freshness model request failed",
        details: {
          triedModelIds: modelIds,
          failures: failures.slice(-6).map((failure) => ({
            modelId: failure.modelId,
            status: failure.status,
            endpointHost: failure.endpoint.replace(/^https?:\/\/([^/]+).*/, "$1"),
            error: failure.error
          }))
        }
      });
    }

    res.json({
      result: bestFreshnessResult || summarizeFreshnessPredictions([]),
      rawModel: bestRawModel || {
        image: data?.image || null,
        modelId: successfulModelId,
        endpointType: endpoint ? new URL(endpoint).hostname : null
      }
    });
  } catch (err) {
    console.error("Freshness check failed:", err && err.message ? err.message : err);
    res.status(500).json({ error: "Unable to check freshness right now" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }
    if (!isAllowedCustomerEmailDomain(email)) {
      return res.status(400).json({ error: "Use a valid Gmail or Yahoo email address (example@gmail.com)" });
    }

    const exists = await models.User.findOne({ email }).lean();
    if (exists) {
      if (!isUserEmailVerified(exists)) {
        return res.status(409).json({
          error: "This email is pending verification. Please verify it to activate your account.",
          requiresEmailVerification: true,
          email
        });
      }
      return res.status(409).json({ error: "Email is already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await models.User.create({
      name,
      email,
      passwordHash,
      mobileNumber: null,
      isEmailVerified: false,
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null
    });

    const verificationCode = await issueEmailVerificationForUser(user);

    runInBackground(
      () => withTimeout(
        sendEmailVerificationEmail({
          toEmail: user.email,
          customerName: user.name,
          verificationCode
        }),
        15000,
        "Verification email"
      ),
      "Signup succeeded but verification email failed"
    );

    const response = {
      ok: true,
      requiresEmailVerification: true,
      email: user.email,
      message: "We sent a 6-digit verification code to your email. Enter it to activate your account."
    };
    if (!hasSmtpConfig()) {
      response.devVerificationCode = verificationCode;
      response.message = "SMTP is not configured. Use the development verification code to activate the account.";
    }

    res.status(201).json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({ error: "Email and verification code are required" });
    }

    const user = await models.User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "Account not found for this email" });
    }

    if (isUserEmailVerified(user)) {
      req.session.user = getSessionUser(user);
      return res.json({ user: req.session.user, alreadyVerified: true });
    }

    const expectedHash = String(user.emailVerificationCodeHash || "");
    const isCodeValid = expectedHash && hashVerificationCode(code) === expectedHash;
    const isCodeFresh = user.emailVerificationExpiresAt && user.emailVerificationExpiresAt > new Date();

    if (!isCodeValid || !isCodeFresh) {
      return res.status(400).json({ error: "Verification code is invalid or expired" });
    }

    user.isEmailVerified = true;
    user.emailVerificationCodeHash = null;
    user.emailVerificationExpiresAt = null;
    await user.save();

    req.session.user = getSessionUser(user);

    runInBackground(
      () => withTimeout(sendWelcomeEmail({ toEmail: user.email, customerName: user.name }), 15000, "Welcome email"),
      "Email verification succeeded but welcome email failed"
    );

    return res.json({
      ok: true,
      user: req.session.user,
      message: "Email verified successfully"
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not verify email" });
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!isAllowedCustomerEmailDomain(email)) {
      return res.status(400).json({ error: "Use a valid Gmail or Yahoo email address (example@gmail.com)" });
    }

    const user = await models.User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "No account found with this email" });
    }
    if (isUserEmailVerified(user)) {
      return res.status(400).json({ error: "This account is already verified" });
    }

    const verificationCode = await issueEmailVerificationForUser(user);

    runInBackground(
      () => withTimeout(
        sendEmailVerificationEmail({
          toEmail: user.email,
          customerName: user.name,
          verificationCode
        }),
        15000,
        "Verification email"
      ),
      "Resend verification email failed"
    );

    const response = {
      ok: true,
      message: "A fresh verification code has been sent to your email."
    };
    if (!hasSmtpConfig()) {
      response.devVerificationCode = verificationCode;
      response.message = "SMTP is not configured. Use the development verification code to activate the account.";
    }

    return res.json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not resend verification code" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await models.User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!isUserEmailVerified(user)) {
      return res.status(403).json({
        error: "Please verify your email before logging in. We can resend the code if needed.",
        requiresEmailVerification: true,
        email: user.email
      });
    }

    req.session.user = getSessionUser(user);
    res.json({ user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }

    const user = await models.User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "No account found with this email" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    user.resetTokenHash = tokenHash;
    user.resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const base = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
    const resetLink = `${base}/reset-password.html?token=${token}`;

    await sendPasswordResetEmail({
      toEmail: email,
      resetLink,
      tokenForDev: token
    });

    if (!hasSmtpConfig()) {
      return res.json({
        ok: true,
        message: "SMTP not configured. Using development token flow.",
        redirectTo: "/reset-password.html",
        resetToken: token,
        email
      });
    }

    return res.json({
      ok: true,
      message: "Reset link sent to your email.",
      redirectTo: "/reset-password.html",
      email
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not process forgot password request" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await models.User.findOne({
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: "Reset token is invalid or expired" });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    await user.save();

    res.json({ ok: true, message: "Password reset successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Password reset failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get("/api/auth/check-email", async (req, res) => {
  const email = normalizeEmail(req.query.email);
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  if (!isAllowedCustomerEmailDomain(email)) {
    return res.status(400).json({ error: "Use a valid Gmail or Yahoo email address (example@gmail.com)" });
  }

  const existingUser = await models.User.findOne({ email }).select("isEmailVerified").lean();
  return res.json({
    available: !existingUser,
    requiresEmailVerification: existingUser ? !isUserEmailVerified(existingUser) : false
  });
});

app.patch("/api/auth/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const mobileNumber = String(req.body.mobileNumber || "").trim();

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }
    if (!isAllowedCustomerEmailDomain(email)) {
      return res.status(400).json({ error: "Use a valid Gmail or Yahoo email address (example@gmail.com)" });
    }
    if (!isValidMobileNumber(mobileNumber)) {
      return res.status(400).json({ error: "Please enter a valid 10-digit mobile number" });
    }

    const currentUser = await models.User.findById(userId).select("email").lean();
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (email !== currentUser.email) {
      return res.status(400).json({
        error: "Email address cannot be changed here yet. Please use your verified signup email for order updates."
      });
    }

    const user = await models.User.findByIdAndUpdate(
      userId,
      { $set: { name, email: currentUser.email, mobileNumber: mobileNumber || null } },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    req.session.user = getSessionUser(user);

    return res.json({ user: req.session.user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not update profile" });
  }
});

app.delete("/api/auth/account", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    await Promise.all([
      models.Order.deleteMany({ userId }),
      models.Complaint.deleteMany({ userId }),
      models.User.deleteOne({ _id: userId })
    ]);

    req.session.destroy(() => {
      res.json({ ok: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete account" });
  }
});

app.post("/api/admin/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || "admin@myfarms.com");
  const adminPassword = String(process.env.ADMIN_PASSWORD || "admin123");

  if (email === adminEmail && password === adminPassword) {
    req.session.admin = {
      email: adminEmail,
      name: "Owner Admin",
      role: "Owner",
      isOwner: true,
      permissions: ADMIN_PERMISSION_KEYS
    };
    return res.json({ admin: req.session.admin, permissionsCatalog: ADMIN_PERMISSIONS });
  }

  const employee = await models.AdministrativeEmployee.findOne({ email });
  if (!employee || employee.active === false) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  const valid = await bcrypt.compare(password, employee.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  req.session.admin = {
    id: String(employee._id),
    email: employee.email,
    name: employee.name,
    role: employee.role,
    isOwner: false,
    permissions: normalizeAdminPermissions(employee.permissions || [])
  };
  return res.json({ admin: req.session.admin, permissionsCatalog: ADMIN_PERMISSIONS });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.admin = null;
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  res.json({ admin: req.session.admin || null, permissionsCatalog: ADMIN_PERMISSIONS });
});

app.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  try {
    if (req.session.admin?.isOwner) {
      return res.status(400).json({
        error: "Owner admin password is managed through ADMIN_PASSWORD environment variable"
      });
    }

    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const employee = await models.AdministrativeEmployee.findById(req.session.admin.id);
    if (!employee || employee.active === false) {
      req.session.admin = null;
      return res.status(401).json({ error: "Admin authentication required" });
    }

    const valid = await bcrypt.compare(currentPassword, employee.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    employee.passwordHash = await bcrypt.hash(newPassword, 10);
    await employee.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to change admin password:", err.message);
    res.status(500).json({ error: "Could not update password" });
  }
});

app.get("/api/admin/permissions", requireAdmin, (req, res) => {
  res.json({
    permissions: ADMIN_PERMISSIONS,
    admin: req.session.admin
  });
});

app.get("/api/admin/employees", requireAdminPermission("administration"), async (_req, res) => {
  const employees = await models.AdministrativeEmployee.find({}).sort({ createdAt: -1 }).lean();
  res.json({ employees: employees.map(serializeAdministrativeEmployee), permissions: ADMIN_PERMISSIONS });
});

app.post("/api/admin/employees", requireAdminPermission("administration"), (req, res) => {
  uploadImage.single("employeePhoto")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Employee photo upload failed" });
    }

    try {
      const name = String(req.body.name || "").trim();
      const email = normalizeEmail(req.body.email);
      const phoneNumber = String(req.body.phoneNumber || "").replace(/\D/g, "");
      const role = String(req.body.role || "").trim();
      const aadhaarNumber = normalizeAadhaarNumber(req.body.aadhaarNumber);
      const password = String(req.body.password || "");
      const dateOfBirth = new Date(req.body.dateOfBirth);
      const permissions = normalizeAdminPermissions(req.body.permissionsJson ? JSON.parse(req.body.permissionsJson) : req.body.permissions);

      if (!name || name.length < 2) return res.status(400).json({ error: "Employee name is required" });
      if (!isAllowedEmployeeEmailDomain(email)) {
        return res.status(400).json({ error: "Use a valid Gmail address for the employee account" });
      }
      if (!isValidContactNumber(phoneNumber)) return res.status(400).json({ error: "Please enter a valid 10-digit phone number" });
      if (Number.isNaN(dateOfBirth.getTime())) return res.status(400).json({ error: "Valid date of birth is required" });
      if (!isValidAadhaarNumber(aadhaarNumber)) return res.status(400).json({ error: "Please enter a valid 12-digit Aadhaar number" });
      if (!role) return res.status(400).json({ error: "Employee role is required" });
      if (password.length < 8) return res.status(400).json({ error: "Temporary password must be at least 8 characters" });
      if (!permissions.length) return res.status(400).json({ error: "Select at least one admin feature access" });
      if (permissions.includes("delivery_assign") && !canRoleAssignDeliveries(role)) {
        return res.status(400).json({ error: "Only Inventory Associate, Operations Manager, or Admin Assistant can assign deliveries" });
      }
      if (!req.file) return res.status(400).json({ error: "Employee photo is required" });

      const exists = await models.AdministrativeEmployee.findOne({ email }).lean();
      if (exists) return res.status(409).json({ error: "An administrative employee already uses this email" });

      const employeePhotoPath = await persistUpload(req.file, { folder: "myfarms/employees", localPrefix: "employee" });
      const employee = await models.AdministrativeEmployee.create({
        name,
        email,
        phoneNumber,
        dateOfBirth,
        role,
        employeePhotoPath,
        aadhaarLast4: aadhaarNumber.slice(-4),
        aadhaarHash: hashAadhaarNumber(aadhaarNumber),
        passwordHash: await bcrypt.hash(password, 10),
        permissions,
        active: true
      });

      runInBackground(
        () =>
          withTimeout(
            sendAdministrativeEmployeeWelcomeEmail({
              toEmail: employee.email,
              employeeName: employee.name,
              role: employee.role,
              temporaryPassword: password
            }),
            15000,
            "Administrative employee welcome email"
          ),
        "Employee welcome email failed"
      );

      return res.status(201).json({ employee: serializeAdministrativeEmployee(employee) });
    } catch (createErr) {
      if (createErr instanceof SyntaxError) {
        return res.status(400).json({ error: "Invalid permissions payload" });
      }
      console.error("Failed to create administrative employee:", createErr.message);
      return res.status(500).json({ error: "Could not create administrative employee" });
    }
  });
});

app.put("/api/admin/employees/:id", requireAdminPermission("administration"), (req, res) => {
  uploadImage.single("employeePhoto")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Employee photo upload failed" });
    }

    try {
      const employee = await models.AdministrativeEmployee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: "Administrative employee not found" });

      const name = String(req.body.name ?? employee.name).trim();
      const email = normalizeEmail(req.body.email ?? employee.email);
      const phoneNumber = String(req.body.phoneNumber ?? employee.phoneNumber).replace(/\D/g, "");
      const role = String(req.body.role ?? employee.role).trim();
      const dateOfBirth = new Date(req.body.dateOfBirth ?? employee.dateOfBirth);
      const permissions = normalizeAdminPermissions(req.body.permissionsJson ? JSON.parse(req.body.permissionsJson) : req.body.permissions ?? employee.permissions);
      const active = req.body.active === undefined ? employee.active !== false : String(req.body.active) === "true";
      const password = String(req.body.password || "");
      const aadhaarNumber = normalizeAadhaarNumber(req.body.aadhaarNumber);

      if (!name || name.length < 2) return res.status(400).json({ error: "Employee name is required" });
      if (!isAllowedEmployeeEmailDomain(email)) {
        return res.status(400).json({ error: "Use a valid Gmail address for the employee account" });
      }
      if (!isValidContactNumber(phoneNumber)) return res.status(400).json({ error: "Please enter a valid 10-digit phone number" });
      if (Number.isNaN(dateOfBirth.getTime())) return res.status(400).json({ error: "Valid date of birth is required" });
      if (!role) return res.status(400).json({ error: "Employee role is required" });
      if (!permissions.length) return res.status(400).json({ error: "Select at least one admin feature access" });
      if (permissions.includes("delivery_assign") && !canRoleAssignDeliveries(role)) {
        return res.status(400).json({ error: "Only Inventory Associate, Operations Manager, or Admin Assistant can assign deliveries" });
      }
      if (password && password.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
      if (aadhaarNumber && !isValidAadhaarNumber(aadhaarNumber)) {
        return res.status(400).json({ error: "Please enter a valid 12-digit Aadhaar number" });
      }

      const duplicate = await models.AdministrativeEmployee.findOne({ email, _id: { $ne: employee._id } }).lean();
      if (duplicate) return res.status(409).json({ error: "An administrative employee already uses this email" });

      employee.name = name;
      employee.email = email;
      employee.phoneNumber = phoneNumber;
      employee.dateOfBirth = dateOfBirth;
      employee.role = role;
      employee.permissions = permissions;
      employee.active = active;
      if (password) employee.passwordHash = await bcrypt.hash(password, 10);
      if (aadhaarNumber) {
        employee.aadhaarLast4 = aadhaarNumber.slice(-4);
        employee.aadhaarHash = hashAadhaarNumber(aadhaarNumber);
      }
      if (req.file) {
        employee.employeePhotoPath = await persistUpload(req.file, { folder: "myfarms/employees", localPrefix: "employee" });
      }

      await employee.save();
      return res.json({ employee: serializeAdministrativeEmployee(employee) });
    } catch (updateErr) {
      if (updateErr instanceof SyntaxError) {
        return res.status(400).json({ error: "Invalid permissions payload" });
      }
      console.error("Failed to update administrative employee:", updateErr.message);
      return res.status(500).json({ error: "Could not update administrative employee" });
    }
  });
});

app.delete("/api/admin/employees/:id", requireAdminPermission("administration"), async (req, res) => {
  const result = await models.AdministrativeEmployee.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) return res.status(404).json({ error: "Administrative employee not found" });
  res.json({ ok: true });
});

app.get("/api/wallet", requireAuth, async (req, res) => {
  const user = await models.User.findById(req.session.user.id).select("walletCoins").lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  const transactions = await models.WalletTransaction.find({ userId: req.session.user.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    balance: Math.max(0, Math.floor(Number(user.walletCoins || 0))),
    rewardRate: {
      coinsPerHundred: 2,
      coinsPerRupee: 0.02,
      rupeesPerCoinEarned: 50,
      coinsPerRupeeRedeemed: 50,
      coinValueInRupees: 0.02
    },
    transactions: transactions.map((tx) => ({
      id: String(tx._id),
      orderId: tx.orderId ? String(tx.orderId) : null,
      type: tx.type,
      coins: tx.coins,
      description: tx.description,
      balanceAfter: tx.balanceAfter,
      createdAt: tx.createdAt
    }))
  });
});

app.get("/api/admin/products", requireAnyAdminPermission(["products", "stock"]), async (_req, res) => {
  const products = await models.Product.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      category: p.category,
      price: p.price,
      unit: p.unit,
      description: p.description || "",
      imagePath: p.imagePath || null,
      stock: p.stock || 0,
      featured: Boolean(p.featured),
      signatureShowcase: Boolean(p.signatureShowcase),
      forceOutOfStock: Boolean(p.forceOutOfStock),
      orderCount: p.orderCount || 0,
      outOfStock: isProductOutOfStock(p),
      variants: (p.variants || []).map((v) => ({
        id: String(v._id || ""),
        name: v.name,
        price: v.price,
        stock: v.stock || 0
      }))
    }))
  });
});

app.put("/api/admin/products/:id", requireAdminPermission("products"), (req, res) => {
  uploadImage.single("image")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "Image upload failed" });

    try {
      const product = await models.Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: "Product not found" });

      const nextName = String(req.body.name ?? product.name).trim();
      const nextCategory = String(req.body.category ?? product.category).trim();
      const nextUnit = String(req.body.unit ?? product.unit).trim();
      const nextDescription = normalizeProductDescription(req.body.description ?? product.description);
      const nextPrice = req.body.price === undefined ? product.price : Number(req.body.price);
      const nextStock = req.body.stock === undefined ? product.stock : Number(req.body.stock);
      const nextFeatured = String(req.body.featured ?? product.featured) === "true";
      const nextSignatureShowcase = String(req.body.signatureShowcase ?? product.signatureShowcase) === "true";
      const nextForceOutOfStock =
        req.body.forceOutOfStock === undefined
          ? Boolean(product.forceOutOfStock)
          : String(req.body.forceOutOfStock) === "true";

      if (!nextName || !nextCategory || !nextUnit || !Number.isFinite(nextPrice) || nextPrice <= 0) {
        return res.status(400).json({ error: "Invalid product fields" });
      }
      if (!Number.isInteger(nextStock) || nextStock < 0) {
        return res.status(400).json({ error: "Stock must be a non-negative integer" });
      }
      if (nextDescription.length > 200) {
        return res.status(400).json({ error: "Product description cannot exceed 200 characters" });
      }

      product.name = nextName;
      product.category = nextCategory;
      product.unit = nextUnit;
      product.description = nextDescription;
      product.price = nextPrice;
      product.stock = nextStock;
      product.featured = nextFeatured;
      product.signatureShowcase = nextSignatureShowcase;
      product.forceOutOfStock = nextForceOutOfStock;
      if (req.file) {
        product.imagePath = await persistUpload(req.file, { folder: "myfarms/products", localPrefix: "product" });
      }
      await product.save();

      res.json({ ok: true });
    } catch (updateErr) {
      console.error("Failed to update product:", updateErr.message);
      res.status(500).json({ error: "Could not update product" });
    }
  });
});

app.delete("/api/admin/products/:id", requireAdminPermission("products"), async (req, res) => {
  const result = await models.Product.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});

app.patch("/api/admin/products/:id/stock-flag", requireAdminPermission("stock"), async (req, res) => {
  const forceOutOfStock = String(req.body.forceOutOfStock) === "true" || req.body.forceOutOfStock === true;
  const restockQuantity = Number(req.body.restockQuantity);
  const variantQuantities = Array.isArray(req.body.variantQuantities) ? req.body.variantQuantities : [];

  const product = await models.Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;

  if (!hasVariants) {
    if (forceOutOfStock) {
      product.forceOutOfStock = true;
      product.stock = 0;
    } else {
      if (!Number.isInteger(restockQuantity) || restockQuantity <= 0) {
        return res.status(400).json({ error: "Valid restock quantity is required when setting In Stock" });
      }
      product.forceOutOfStock = false;
      product.stock = restockQuantity;
    }

    await product.save();
    return res.json({ ok: true, stock: product.stock, forceOutOfStock: product.forceOutOfStock });
  }

  const variantStockMap = new Map(variantQuantities.map((v) => [String(v.variantId || ""), Number(v.stock)]));
  if (variantStockMap.size !== product.variants.length) {
    return res.status(400).json({ error: "Please provide quantity for every variant" });
  }

  let totalVariantStock = 0;
  let hasAnyPositiveStock = false;
  let hasAnyNonZeroStock = false;

  for (const variant of product.variants) {
    const nextStock = variantStockMap.get(String(variant._id));
    if (!Number.isInteger(nextStock) || nextStock < 0) {
      return res.status(400).json({ error: "Each variant must have a valid non-negative quantity" });
    }
    variant.stock = nextStock;
    totalVariantStock += nextStock;
    if (nextStock > 0) {
      hasAnyPositiveStock = true;
      hasAnyNonZeroStock = true;
    }
  }

  if (forceOutOfStock) {
    if (hasAnyNonZeroStock) {
      return res.status(400).json({ error: "Set all variant quantities to 0 before marking product out of stock" });
    }
    product.forceOutOfStock = true;
    product.stock = 0;
  } else {
    if (!hasAnyPositiveStock) {
      return res.status(400).json({ error: "At least one variant quantity should be greater than 0" });
    }
    product.forceOutOfStock = false;
    product.stock = totalVariantStock;
  }

  await product.save();
  res.json({ ok: true, stock: product.stock, forceOutOfStock: product.forceOutOfStock });
});

app.post("/api/admin/products/:id/variants", requireAdminPermission("products"), async (req, res) => {
  const product = await models.Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const name = String(req.body.name || "").trim();
  const price = Number(req.body.price);
  const stock = Number(req.body.stock ?? 0);

  if (!name || !Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: "Variant name and valid price are required" });
  }
  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: "Variant stock must be non-negative integer" });
  }

  product.variants.push({ name, price, stock });
  product.isVariantParent = product.variants.length > 0;
  await product.save();
  res.status(201).json({ ok: true });
});

app.put("/api/admin/products/:id/variants/:variantId", requireAdminPermission("products"), async (req, res) => {
  const product = await models.Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const variant = product.variants.id(req.params.variantId);
  if (!variant) return res.status(404).json({ error: "Variant not found" });

  const nextName = String(req.body.name ?? variant.name).trim();
  const nextPrice = req.body.price === undefined ? variant.price : Number(req.body.price);
  const nextStock = req.body.stock === undefined ? variant.stock : Number(req.body.stock);

  if (!nextName || !Number.isFinite(nextPrice) || nextPrice <= 0) {
    return res.status(400).json({ error: "Invalid variant fields" });
  }
  if (!Number.isInteger(nextStock) || nextStock < 0) {
    return res.status(400).json({ error: "Variant stock must be non-negative integer" });
  }

  variant.name = nextName;
  variant.price = nextPrice;
  variant.stock = nextStock;
  await product.save();
  res.json({ ok: true });
});

app.delete("/api/admin/products/:id/variants/:variantId", requireAdminPermission("products"), async (req, res) => {
  const product = await models.Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const variant = product.variants.id(req.params.variantId);
  if (!variant) return res.status(404).json({ error: "Variant not found" });

  variant.deleteOne();
  product.isVariantParent = product.variants.length > 0;
  await product.save();
  res.json({ ok: true });
});

app.get("/api/admin/promos", requireAdminPermission("promos"), async (_req, res) => {
  const promos = await models.PromoCode.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    promos: promos.map((p) => ({
      id: String(p._id),
      code: p.code,
      discountPercent: p.discountPercent,
      minOrderValue: p.minOrderValue,
      maxUses: p.maxUses,
      usedCount: p.usedCount,
      expiresAt: p.expiresAt,
      active: p.active,
      showOnHomepage: Boolean(p.showOnHomepage)
    }))
  });
});

app.get("/api/promos/live", async (_req, res) => {
  const now = new Date();
  const promos = await models.PromoCode.find({
    active: true,
    showOnHomepage: true,
    expiresAt: { $gt: now },
    $expr: { $lt: ["$usedCount", "$maxUses"] }
  })
    .sort({ discountPercent: -1, createdAt: -1 })
    .limit(8)
    .lean();

  res.json({
    promos: promos.map((p) => ({
      id: String(p._id),
      code: p.code,
      discountPercent: p.discountPercent,
      minOrderValue: p.minOrderValue,
      expiresAt: p.expiresAt
    }))
  });
});

app.post("/api/admin/promos", requireAdminPermission("promos"), async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const discountPercent = Number(req.body.discountPercent);
  const minOrderValue = Number(req.body.minOrderValue || 0);
  const maxUses = Number(req.body.maxUses || 100);
  const expiresAt = new Date(req.body.expiresAt);
  const showOnHomepage = Boolean(req.body.showOnHomepage);

  if (!/^[A-Z0-9]{4,20}$/.test(code)) return res.status(400).json({ error: "Promo code must be 4-20 alphanumeric" });
  if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 90) {
    return res.status(400).json({ error: "Discount percent must be between 1 and 90" });
  }
  if (!Number.isFinite(minOrderValue) || minOrderValue < 0) return res.status(400).json({ error: "Invalid minimum order value" });
  if (!Number.isInteger(maxUses) || maxUses < 1) return res.status(400).json({ error: "maxUses must be at least 1" });
  if (Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: "Invalid expiry date" });

  try {
    await models.PromoCode.create({ code, discountPercent, minOrderValue, maxUses, expiresAt, active: true, showOnHomepage });
    res.status(201).json({ ok: true });
  } catch (promoErr) {
    if (promoErr.code === 11000) return res.status(409).json({ error: "Promo code already exists" });
    res.status(500).json({ error: "Could not create promo code" });
  }
});

app.patch("/api/admin/promos/:id", requireAdminPermission("promos"), async (req, res) => {
  const update = {};
  if (req.body.active !== undefined) update.active = Boolean(req.body.active);
  if (req.body.showOnHomepage !== undefined) update.showOnHomepage = Boolean(req.body.showOnHomepage);
  if (req.body.expiresAt !== undefined) {
    const d = new Date(req.body.expiresAt);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid expiry date" });
    update.expiresAt = d;
  }

  const result = await models.PromoCode.updateOne({ _id: req.params.id }, { $set: update });
  if (!result.matchedCount) return res.status(404).json({ error: "Promo not found" });
  res.json({ ok: true });
});

app.delete("/api/admin/promos/:id", requireAdminPermission("promos"), async (req, res) => {
  const result = await models.PromoCode.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) return res.status(404).json({ error: "Promo not found" });
  res.json({ ok: true });
});

app.get("/api/promos/validate", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const subtotalAmount = Number(req.query.subtotal || 0);

  try {
    const { promo, discountAmount } = await validatePromoCode({ promoCode: code, subtotalAmount });
    if (!promo) return res.json({ valid: false, discountAmount: 0, message: "No promo applied" });
    return res.json({
      valid: true,
      code: promo.code,
      discountPercent: promo.discountPercent,
      discountAmount
    });
  } catch (err) {
    return res.status(400).json({ valid: false, error: err.message });
  }
});

app.get("/api/admin/dashboard", requireAdminPermission("dashboard"), async (req, res) => {
  const from = parseDateInput(req.query.dateFrom);
  const to = parseDateInput(req.query.dateTo, true);
  const status = String(req.query.status || "").trim();
  const category = String(req.query.category || "").trim();

  const orderQuery = {};
  if (from || to) {
    orderQuery.createdAt = {};
    if (from) orderQuery.createdAt.$gte = from;
    if (to) orderQuery.createdAt.$lte = to;
  }
  if (status) orderQuery.status = status;

  const orders = await models.Order.find(orderQuery).lean();
  const totalOrders = orders.length;
  const totalSales = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const todaySalesOrders = await models.Order.find({ createdAt: { $gte: startToday, $lte: endToday } }).lean();
  const todaySales = todaySalesOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  const topProductsRaw = await models.Order.aggregate([
    { $match: orderQuery },
    { $unwind: "$items" },
    { $group: { _id: "$items.productName", soldQty: { $sum: "$items.quantity" } } },
    { $sort: { soldQty: -1 } },
    { $limit: 5 }
  ]);

  const orderTrendRaw = await models.Order.aggregate([
    { $match: orderQuery },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        orders: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const baseProductQuery = category ? { category } : {};
  const allProducts = await models.Product.find(baseProductQuery).lean();
  const lowStockProducts = allProducts
    .map((p) => {
      const variantStocks = (p.variants || []).map((v) => Number(v.stock || 0));
      const minVariantStock = variantStocks.length ? Math.min(...variantStocks) : null;
      const effectiveStock = minVariantStock === null ? Number(p.stock || 0) : minVariantStock;
      return { ...p, effectiveStock };
    })
    .filter((p) => p.effectiveStock <= 5)
    .sort((a, b) => a.effectiveStock - b.effectiveStock || a.name.localeCompare(b.name));

  res.json({
    kpis: {
      todaySales: Number(todaySales.toFixed(2)),
      totalOrders,
      totalSales: Number(totalSales.toFixed(2)),
      lowStockCount: lowStockProducts.length
    },
    topProducts: topProductsRaw.map((p) => ({ name: p._id, soldQty: p.soldQty })),
    orderTrend: orderTrendRaw.map((r) => ({ date: r._id, orders: r.orders })),
    lowStockProducts: lowStockProducts.map((p) => ({
      id: String(p._id),
      name: p.name,
      category: p.category,
      stock: p.effectiveStock
    }))
  });
});

app.get("/api/products", async (_req, res) => {
  const products = await models.Product.find({})
    .sort({ category: 1, name: 1 })
    .lean();

  const payload = products.map((p) => ({
    id: String(p._id),
    name: p.name,
    category: p.category,
    price: p.price,
    unit: p.unit,
    description: p.description || "",
    imagePath: p.imagePath || null,
    stock: p.stock || 0,
    featured: Boolean(p.featured),
    signatureShowcase: Boolean(p.signatureShowcase),
    forceOutOfStock: Boolean(p.forceOutOfStock),
    orderCount: p.orderCount || 0,
    outOfStock: isProductOutOfStock(p),
    isVariantParent: p.isVariantParent,
    createdAt: p.createdAt,
    variants: (p.variants || []).map((v) => ({
      id: String(v._id || ""),
      name: v.name,
      price: v.price,
      stock: v.stock || 0
    }))
  }));

  res.json({ products: payload });
});

app.post("/api/admin/products", requireAdminPermission("products"), (req, res) => {
  uploadImage.single("image")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Image upload failed" });
    }

    try {
      const name = String(req.body.name || "").trim();
      const category = String(req.body.category || "").trim();
      const unit = String(req.body.unit || "").trim() || "kg";
      const description = normalizeProductDescription(req.body.description);
      const price = Number(req.body.price);
      const stock = Number(req.body.stock ?? 0);
      const featured = String(req.body.featured || "false") === "true";
      const signatureShowcase = String(req.body.signatureShowcase || "false") === "true";
      const forceOutOfStock = String(req.body.forceOutOfStock || "false") === "true";
      const rawVariants = String(req.body.variantsJson || "[]");
      let variantsPayload = [];

      if (!name || !category || !Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: "Name, category, and valid price are required" });
      }
      if (!Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ error: "Stock must be a non-negative integer" });
      }
      if (description.length > 200) {
        return res.status(400).json({ error: "Product description cannot exceed 200 characters" });
      }

      try {
        const parsed = JSON.parse(rawVariants);
        if (Array.isArray(parsed)) {
          variantsPayload = parsed
            .map((v) => ({
              name: String(v.name || "").trim(),
              price: Number(v.price),
              stock: Number(v.stock ?? 0)
            }))
            .filter((v) => v.name && Number.isFinite(v.price) && v.price > 0 && Number.isInteger(v.stock) && v.stock >= 0);
        }
      } catch {
        variantsPayload = [];
      }

      const imagePath = req.file
        ? await persistUpload(req.file, { folder: "myfarms/products", localPrefix: "product" })
        : null;

      const product = await models.Product.create({
        name,
        category,
        unit,
        description,
        price,
        stock,
        featured,
        signatureShowcase,
        forceOutOfStock,
        imagePath,
        isVariantParent: variantsPayload.length > 0,
        variants: variantsPayload
      });

      return res.status(201).json({
        product: {
          id: String(product._id),
          name: product.name,
          category: product.category,
          unit: product.unit,
          description: product.description || "",
          price: product.price,
          imagePath: product.imagePath
        }
      });
    } catch (createErr) {
      console.error("Failed to create product:", createErr.message);
      return res.status(500).json({ error: "Could not create product" });
    }
  });
});

app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const { items, paymentMethod, address, fullName, contactNumber, tipAmount, promoCode, useWalletCoins } = req.body;

    const { parsedTip } = orderLogic.validateOrderRequest({
      items,
      paymentMethod,
      address,
      fullName,
      contactNumber,
      tipAmount
    });

    const resolvedItems = [];
    let subtotalAmount = 0;

    for (const rawItem of items) {
      const product = await models.Product.findById(rawItem.productId).lean();
      const resolvedItem = orderLogic.resolveOrderItem(rawItem, product);
      subtotalAmount += resolvedItem.subtotal;
      resolvedItems.push(resolvedItem);
    }

    const sessionUser = req.session.user;
    const userDoc = await models.User.findById(sessionUser.id).select("email name walletCoins").lean();
    if (!userDoc) {
      return res.status(404).json({ error: "User not found" });
    }

    const finalAddress = paymentMethod === "PICKUP" ? "Store Pickup" : address.trim();
    const normalizedFullName = String(fullName).trim();
    const normalizedContactNumber = String(contactNumber).trim();
    const normalizedPromoCode = String(promoCode || "").trim();
    const { promo, discountAmount } = await validatePromoCode({ promoCode: normalizedPromoCode, subtotalAmount });
    const {
      taxableAmount,
      taxAmount,
      walletBalance,
      walletDiscountAmount,
      walletCoinsRedeemed,
      finalTotal,
      coinsEarned
    } = orderLogic.calculateOrderTotals({
      subtotalAmount,
      discountAmount,
      tipAmount: parsedTip,
      walletCoins: userDoc.walletCoins,
      useWalletCoins,
      taxRate: TAX_RATE
    });

    const order = await models.Order.create({
      userId: sessionUser.id,
      customerName: normalizedFullName,
      customerEmail: userDoc.email,
      customerPhone: normalizedContactNumber,
      tipAmount: Number(parsedTip.toFixed(2)),
      deliveryAddress: finalAddress,
      paymentMethod,
      subtotalAmount: Number(subtotalAmount.toFixed(2)),
      promoCode: promo ? promo.code : null,
      discountAmount,
      walletCoinsRedeemed,
      walletDiscountAmount,
      coinsEarned,
      taxAmount,
      totalAmount: finalTotal,
      status: "PLACED",
      items: resolvedItems.map((i) => ({
        productId: i.productId,
        productName: i.name,
        variantName: i.variant,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        subtotal: Number(i.subtotal.toFixed(2))
      }))
    });

    const emailPayload = {
      orderId: String(order._id),
      customerName: normalizedFullName,
      customerEmail: userDoc.email,
      customerPhone: normalizedContactNumber,
      tipAmount: Number(parsedTip.toFixed(2)),
      paymentMethod,
      address: finalAddress,
      items: resolvedItems,
      subtotalAmount: Number(subtotalAmount.toFixed(2)),
      promoCode: promo ? promo.code : null,
      discountAmount,
      walletCoinsRedeemed,
      walletDiscountAmount,
      coinsEarned,
      taxAmount,
      totalAmount: finalTotal.toFixed(2)
    };

    for (const item of resolvedItems) {
      const stockUpdate = orderLogic.buildStockUpdate(item);
      await models.Product.updateOne(stockUpdate.filter, stockUpdate.update);
    }

    if (promo) {
      await models.PromoCode.updateOne({ _id: promo._id }, { $inc: { usedCount: 1 } });
    }

    let nextWalletBalance = walletBalance;
    const walletTransactions = [];
    if (walletCoinsRedeemed > 0) {
      nextWalletBalance -= walletCoinsRedeemed;
      walletTransactions.push({
        userId: sessionUser.id,
        orderId: order._id,
        type: "REDEEM",
        coins: -walletCoinsRedeemed,
        description: `Redeemed on order #${String(order._id).slice(-6).toUpperCase()}`,
        balanceAfter: nextWalletBalance
      });
    }
    if (coinsEarned > 0) {
      nextWalletBalance += coinsEarned;
      walletTransactions.push({
        userId: sessionUser.id,
        orderId: order._id,
        type: "EARN",
        coins: coinsEarned,
        description: `Earned from order #${String(order._id).slice(-6).toUpperCase()}`,
        balanceAfter: nextWalletBalance
      });
    }
    if (walletTransactions.length) {
      await models.User.updateOne({ _id: sessionUser.id }, { $set: { walletCoins: nextWalletBalance } });
      await models.WalletTransaction.insertMany(walletTransactions);
      req.session.user = { ...req.session.user, walletCoins: nextWalletBalance };
    }

    res.status(201).json({
      orderId: String(order._id),
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      walletCoinsRedeemed,
      walletDiscountAmount,
      coinsEarned,
      walletBalance: nextWalletBalance,
      taxAmount: order.taxAmount,
      totalAmount: finalTotal,
      status: "PLACED"
    });

    runInBackground(async () => {
      const results = await Promise.allSettled([
        withTimeout(sendOrderEmail(emailPayload), 15000, "Owner order email"),
        withTimeout(sendCustomerOrderEmail(emailPayload), 15000, "Customer order email")
      ]);
      const failures = results
        .filter((result) => result.status === "rejected")
        .map((result) => (result.reason && result.reason.message ? result.reason.message : "Unknown email error"));
      if (failures.length) {
        console.error("Order created but some emails failed:", failures.join(" | "));
      }
    }, "Order email background job failed");

    return;
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create order" });
  }
});

app.get("/api/orders/my", requireAuth, async (req, res) => {
  await cleanupOldOrders();
  const orders = await models.Order.find({ userId: req.session.user.id })
    .sort({ createdAt: -1 })
    .select("deliveryAddress paymentMethod subtotalAmount discountAmount walletCoinsRedeemed walletDiscountAmount coinsEarned taxAmount tipAmount totalAmount status cancelNote createdAt promoCode items")
    .lean();

  res.json({
    orders: orders.map((o) => ({
      id: String(o._id),
      deliveryAddress: o.deliveryAddress,
      paymentMethod: o.paymentMethod,
      subtotalAmount: o.subtotalAmount || 0,
      discountAmount: o.discountAmount || 0,
      walletCoinsRedeemed: o.walletCoinsRedeemed || 0,
      walletDiscountAmount: o.walletDiscountAmount || 0,
      coinsEarned: o.coinsEarned || 0,
      taxAmount: o.taxAmount || 0,
      tipAmount: o.tipAmount || 0,
      promoCode: o.promoCode || null,
      totalAmount: o.totalAmount,
      status: o.status,
      cancelNote: o.cancelNote || null,
      createdAt: o.createdAt,
      items: (o.items || []).map((it) => ({
        productId: String(it.productId),
        productName: it.productName,
        variantName: it.variantName,
        quantity: it.quantity
      }))
    }))
  });
});

app.post("/api/orders/:id/reorder", requireAuth, async (req, res) => {
  const order = await models.Order.findOne({ _id: req.params.id, userId: req.session.user.id }).lean();
  if (!order) return res.status(404).json({ error: "Order not found" });

  const items = (order.items || []).map((it) => ({
    productId: String(it.productId),
    quantity: it.quantity,
    variant: it.variantName || null
  }));

  res.json({ ok: true, items });
});

app.post("/api/complaints", requireAuth, (req, res) => {
  uploadComplaintImage.single("proofImage")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Image upload failed" });
    }

    try {
      await cleanupOldComplaints();
      const orderNumberInput = String(req.body.orderNumber || "")
        .trim()
        .replace(/^#/, "")
        .toUpperCase();
      const issue = String(req.body.issue || "").trim();

      if (!orderNumberInput || orderNumberInput.length < 4) {
        return res.status(400).json({ error: "Valid order number is required" });
      }
      if (issue.length < 10) {
        return res.status(400).json({ error: "Please describe the issue in at least 10 characters" });
      }

      const orders = await models.Order.find({ userId: req.session.user.id }).select("_id").lean();
      const matchedOrder = orders.find((o) => {
        const fullId = String(o._id).toUpperCase();
        return fullId === orderNumberInput || fullId.endsWith(orderNumberInput);
      });

      if (!matchedOrder) {
        return res.status(400).json({ error: "Order number not found for your account" });
      }

      const fullOrderId = String(matchedOrder._id);
      const displayOrderNumber = `#${fullOrderId.slice(-6).toUpperCase()}`;

      const complaint = await models.Complaint.create({
        userId: req.session.user.id,
        orderId: matchedOrder._id,
        orderNumber: displayOrderNumber,
        issue,
        proofImagePath: req.file
          ? await persistUpload(req.file, { folder: "myfarms/complaints", localPrefix: "complaint" })
          : null,
        customerName: req.session.user.name,
        customerEmail: req.session.user.email
      });

      try {
        await sendComplaintCreatedEmails({
          complaintId: String(complaint._id),
          orderNumber: displayOrderNumber,
          issue,
          customerName: complaint.customerName,
          customerEmail: complaint.customerEmail
        });
      } catch (mailErr) {
        console.error("Complaint created but email failed:", mailErr.message);
      }

      res.status(201).json({
        ok: true,
        complaintId: String(complaint._id),
        ticketNumber: String(complaint._id).slice(-6).toUpperCase()
      });
    } catch (createErr) {
      console.error("Failed to create complaint:", createErr.message);
      res.status(500).json({ error: "Could not submit complaint" });
    }
  });
});

app.get("/api/complaints/my", requireAuth, async (req, res) => {
  await cleanupOldComplaints();
  const complaints = await models.Complaint.find({ userId: req.session.user.id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    complaints: complaints.map((c) => ({
      id: String(c._id),
      ticketNumber: String(c._id).slice(-6).toUpperCase(),
      orderNumber: c.orderNumber,
      issue: c.issue,
      proofImagePath: c.proofImagePath || null,
      status: c.status,
      adminReply: c.adminReply || null,
      repliedAt: c.repliedAt || null,
      closedAt: c.closedAt || null,
      createdAt: c.createdAt,
      timeline: buildComplaintTimeline(c)
    }))
  });
});

app.get("/api/admin/orders", requireAnyAdminPermission(["orders", "alerts", "delivery_assign"]), async (_req, res) => {
  await cleanupOldOrders();
  const dateFrom = parseDateInput(_req.query.dateFrom);
  const dateTo = parseDateInput(_req.query.dateTo, true);
  const status = String(_req.query.status || "").trim();
  const category = String(_req.query.category || "").trim();

  const query = {};
  if (status) query.status = status;
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = dateFrom;
    if (dateTo) query.createdAt.$lte = dateTo;
  }

  let orders = await models.Order.find(query)
    .sort({ createdAt: -1 })
    .select("customerName customerEmail customerPhone deliveryAddress paymentMethod subtotalAmount discountAmount taxAmount tipAmount totalAmount status cancelNote createdAt items promoCode deliveryEmployeeId deliveryAssignedBy deliveryAssignedAt deliveryAcceptedAt deliveryCompletedAt deliveryCanceledAt deliveryCancelNote")
    .populate("deliveryEmployeeId", "name email phoneNumber role employeePhotoPath active")
    .lean();

  if (category) {
    const categoryProducts = await models.Product.find({ category }).select("_id").lean();
    const productIdSet = new Set(categoryProducts.map((p) => String(p._id)));
    orders = orders.filter((o) =>
      (o.items || []).some((it) => productIdSet.has(String(it.productId)))
    );
  }

  res.json({
    orders: orders.map((o) => ({
      id: String(o._id),
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      customerPhone: o.customerPhone,
      deliveryAddress: o.deliveryAddress,
      paymentMethod: o.paymentMethod,
      subtotalAmount: o.subtotalAmount || 0,
      discountAmount: o.discountAmount || 0,
      taxAmount: o.taxAmount || 0,
      tipAmount: o.tipAmount || 0,
      promoCode: o.promoCode || null,
      totalAmount: o.totalAmount,
      status: o.status,
      cancelNote: o.cancelNote || null,
      delivery: serializeOrderDelivery(o),
      createdAt: o.createdAt,
      items: (o.items || []).map((it) => ({
        productId: String(it.productId),
        productName: it.productName,
        variantName: it.variantName,
        quantity: it.quantity
      }))
    }))
  });
});

app.get("/api/admin/delivery/agents", requireAdminPermission("delivery_assign"), async (_req, res) => {
  const employees = await models.AdministrativeEmployee.find({
    active: true,
    permissions: "delivery_agent"
  })
    .sort({ name: 1 })
    .lean();

  const activeCounts = await models.Order.aggregate([
    {
      $match: {
        deliveryEmployeeId: { $ne: null },
        status: { $nin: ["DELIVERED", "CANCELED"] }
      }
    },
    { $group: { _id: "$deliveryEmployeeId", activeDeliveries: { $sum: 1 } } }
  ]);
  const countMap = new Map(activeCounts.map((item) => [String(item._id), item.activeDeliveries]));

  res.json({
    agents: employees.map((employee) => ({
      ...serializeDeliveryEmployee(employee),
      activeDeliveries: countMap.get(String(employee._id)) || 0
    }))
  });
});

app.post("/api/admin/orders/:id/assign-delivery", requireAdminPermission("delivery_assign"), async (req, res) => {
  try {
    const employeeId = String(req.body.employeeId || "").trim();
    if (!employeeId) return res.status(400).json({ error: "Delivery agent is required" });

    const employee = await models.AdministrativeEmployee.findOne({
      _id: employeeId,
      active: true,
      permissions: "delivery_agent"
    });
    if (!employee) return res.status(404).json({ error: "Active delivery agent not found" });

    const order = await models.Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (["DELIVERED", "CANCELED"].includes(order.status)) {
      return res.status(400).json({ error: "Delivered or canceled orders cannot be reassigned" });
    }

    order.deliveryEmployeeId = employee._id;
    order.deliveryAssignedBy = getAdminActorLabel(req.session.admin);
    order.deliveryAssignedAt = new Date();
    order.deliveryAcceptedAt = null;
    order.deliveryCanceledAt = null;
    order.deliveryCancelNote = null;
    if (order.status === "PLACED") order.status = "ASSIGNED";
    await order.save();

    runInBackground(
      () =>
        withTimeout(
          sendDeliveryAssignmentEmail({
            toEmail: employee.email,
            employeeName: employee.name,
            orderId: String(order._id),
            customerName: order.customerName,
            paymentMethod: order.paymentMethod,
            deliveryAddress: order.deliveryAddress
          }),
          15000,
          "Delivery assignment email"
        ),
      "Delivery assignment email failed"
    );

    res.json({ ok: true, assignedTo: serializeDeliveryEmployee(employee), status: order.status });
  } catch (err) {
    console.error("Failed to assign delivery:", err.message);
    res.status(500).json({ error: "Could not assign delivery" });
  }
});

app.get("/api/admin/deliveries/my", requireAdminPermission("delivery_agent"), async (req, res) => {
  const cutoff = new Date(Date.now() - ORDER_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const orders = await models.Order.find({
    deliveryEmployeeId: req.session.admin.id,
    $or: [{ deliveryAssignedAt: { $gte: cutoff } }, { createdAt: { $gte: cutoff } }]
  })
    .sort({ deliveryAssignedAt: -1, createdAt: -1 })
    .select("customerName customerEmail customerPhone deliveryAddress paymentMethod totalAmount status cancelNote createdAt items deliveryAssignedBy deliveryAssignedAt deliveryAcceptedAt deliveryCancelNote")
    .lean();

  res.json({
    deliveries: orders.map((o) => ({
      id: String(o._id),
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      customerPhone: o.customerPhone,
      deliveryAddress: o.deliveryAddress,
      paymentMethod: o.paymentMethod,
      totalAmount: o.totalAmount,
      status: o.status,
      cancelNote: o.cancelNote || null,
      deliveryAssignedBy: o.deliveryAssignedBy || null,
      deliveryAssignedAt: o.deliveryAssignedAt || null,
      deliveryAcceptedAt: o.deliveryAcceptedAt || null,
      createdAt: o.createdAt,
      items: (o.items || []).map((it) => ({
        productName: it.productName,
        variantName: it.variantName,
        quantity: it.quantity
      }))
    }))
  });
});

app.post("/api/admin/deliveries/:id/accept", requireAdminPermission("delivery_agent"), async (req, res) => {
  const order = await models.Order.findOne({ _id: req.params.id, deliveryEmployeeId: req.session.admin.id });
  if (!order) return res.status(404).json({ error: "Assigned delivery not found" });
  if (["DELIVERED", "CANCELED"].includes(order.status)) {
    return res.status(400).json({ error: "This delivery is already closed" });
  }

  order.deliveryAcceptedAt = new Date();
  if (order.status === "ASSIGNED") order.status = "ACCEPTED_BY_DELIVERY";
  await order.save();
  res.json({ ok: true, status: order.status });
});

app.post("/api/admin/deliveries/:id/status", requireAdminPermission("delivery_agent"), async (req, res) => {
  try {
    const allowed = ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELED"];
    const status = String(req.body.status || "").trim();
    const cancelNote = String(req.body.cancelNote || "").trim();
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid delivery status" });
    if (status === "CANCELED" && cancelNote.length < 3) {
      return res.status(400).json({ error: "Cancel reason is required" });
    }

    const order = await models.Order.findOne({ _id: req.params.id, deliveryEmployeeId: req.session.admin.id });
    if (!order) return res.status(404).json({ error: "Assigned delivery not found" });
    if (!order.deliveryAcceptedAt) return res.status(400).json({ error: "Accept this delivery before updating status" });
    if (["DELIVERED", "CANCELED"].includes(order.status)) {
      return res.status(400).json({ error: "This delivery is already closed" });
    }

    order.status = status;
    if (status === "DELIVERED") {
      order.deliveryCompletedAt = new Date();
      order.cancelNote = null;
      order.deliveryCancelNote = null;
    }
    if (status === "CANCELED") {
      order.cancelNote = cancelNote;
      order.deliveryCancelNote = cancelNote;
      order.deliveryCanceledAt = new Date();
    }
    await order.save();

    res.json({ ok: true, status: order.status });

    runInBackground(
      () =>
        withTimeout(
          sendOrderStatusEmail({
            toEmail: order.customerEmail,
            customerName: order.customerName,
            orderId: String(order._id),
            status,
            cancelNote: order.cancelNote
          }),
          15000,
          "Delivery status email"
        ),
      "Delivery status updated but customer email failed"
    );
  } catch (err) {
    console.error("Failed to update delivery status:", err.message);
    res.status(500).json({ error: "Could not update delivery status" });
  }
});

app.get("/api/admin/complaints", requireAdminPermission("complaints"), async (req, res) => {
  await cleanupOldComplaints();
  const status = String(req.query.status || "").trim().toUpperCase();
  const query = {};
  if (status === "OPEN" || status === "CLOSED") {
    query.status = status;
  }

  const complaints = await models.Complaint.find(query)
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    complaints: complaints.map((c) => ({
      id: String(c._id),
      ticketNumber: String(c._id).slice(-6).toUpperCase(),
      orderNumber: c.orderNumber,
      issue: c.issue,
      proofImagePath: c.proofImagePath || null,
      customerName: c.customerName,
      customerEmail: c.customerEmail,
      status: c.status,
      adminReply: c.adminReply || null,
      repliedAt: c.repliedAt || null,
      closedAt: c.closedAt || null,
      createdAt: c.createdAt,
      timeline: buildComplaintTimeline(c)
    }))
  });
});

app.post("/api/admin/complaints/:id/reply", requireAdminPermission("complaints"), async (req, res) => {
  try {
    const replyMessage = String(req.body.replyMessage || "").trim();
    const closeTicket = Boolean(req.body.closeTicket);

    if (!replyMessage && !closeTicket) {
      return res.status(400).json({ error: "Provide a reply or close the ticket" });
    }
    if (replyMessage && replyMessage.length < 3) {
      return res.status(400).json({ error: "Reply should be at least 3 characters" });
    }

    const complaint = await models.Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    if (replyMessage) {
      complaint.adminReply = replyMessage;
      complaint.repliedAt = new Date();
    }
    if (closeTicket) {
      complaint.status = "CLOSED";
      complaint.closedAt = new Date();
    }

    await complaint.save();

    if (closeTicket) {
      try {
        await sendComplaintClosedEmail({
          toEmail: complaint.customerEmail,
          customerName: complaint.customerName,
          complaintId: String(complaint._id),
          orderNumber: complaint.orderNumber,
          closingNote: replyMessage || "Your complaint was reviewed by our support team."
        });
      } catch (mailErr) {
        console.error("Complaint updated but closed email failed:", mailErr.message);
      }
    }

    res.json({ ok: true, status: complaint.status });
  } catch (err) {
    console.error("Failed to update complaint:", err.message);
    res.status(500).json({ error: "Could not update complaint" });
  }
});

async function updateOrderStatusHandler(req, res) {
  try {
    const allowed = ["OUT_FOR_DELIVERY", "ORDER_READY_FOR_PICKUP", "DELIVERED", "CANCELED"];
    const status = String(req.body.status || "").trim();
    const cancelNote = String(req.body.cancelNote || "").trim();

    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status update" });
    }
    if (status === "CANCELED" && cancelNote.length < 3) {
      return res.status(400).json({ error: "Cancel reason is required" });
    }

    const order = await models.Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    order.status = status;
    order.cancelNote = status === "CANCELED" ? cancelNote : null;
    await order.save();

    res.json({ ok: true, status: order.status });

    runInBackground(
      () =>
        withTimeout(
          sendOrderStatusEmail({
            toEmail: order.customerEmail,
            customerName: order.customerName,
            orderId: String(order._id),
            status,
            cancelNote: order.cancelNote
          }),
          15000,
          "Order status email"
        ),
      "Order status updated but status email failed"
    );

    return;
  } catch (err) {
    console.error("Failed to update order status:", err.message);
    res.status(500).json({ error: "Could not update order status" });
  }
}

app.patch("/api/admin/orders/:id/status", requireAdminPermission("orders"), updateOrderStatusHandler);
app.post("/api/admin/orders/:id/status", requireAdminPermission("orders"), updateOrderStatusHandler);

app.get("*", (_req, res) => {
  if (fs.existsSync(reactIndexPath)) {
    return res.sendFile(reactIndexPath);
  }
  return res.sendFile(path.join(publicDir, "index.html"));
});

initDb()
  .then(async () => {
    await cleanupOldOrders();
    await cleanupOldComplaints();
    setInterval(() => {
      cleanupOldOrders().catch((err) => {
        console.error("Failed old-order cleanup:", err.message);
      });
      cleanupOldComplaints().catch((err) => {
        console.error("Failed old-complaint cleanup:", err.message);
      });
    }, 12 * 60 * 60 * 1000);

    app.listen(PORT, () => {
      console.log(`My Farms server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
