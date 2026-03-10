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
const {
  sendOrderEmail,
  sendCustomerOrderEmail,
  sendPasswordResetEmail,
  sendOrderStatusEmail,
  sendComplaintCreatedEmails,
  sendComplaintClosedEmail,
  sendWelcomeEmail,
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
const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MS || 1000 * 60 * 30);
const MongoStore = MongoStoreModule && MongoStoreModule.default ? MongoStoreModule.default : MongoStoreModule;

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

app.use(express.json());
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

const uploadImage = multer({
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

const uploadComplaintImage = multer({
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

function isValidContactNumber(contactNumber) {
  return /^\d{10}$/.test(String(contactNumber || "").trim());
}

function isValidMobileNumber(mobileNumber) {
  if (mobileNumber === null || mobileNumber === undefined || String(mobileNumber).trim() === "") return true;
  return /^\d{10}$/.test(String(mobileNumber).trim());
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

async function validatePromoCode({ promoCode, subtotalAmount }) {
  const code = String(promoCode || "").trim().toUpperCase();
  if (!code) {
    return { promo: null, discountAmount: 0 };
  }

  const promo = await models.PromoCode.findOne({ code, active: true });
  if (!promo) {
    throw new Error("Invalid promo code");
  }

  if (promo.expiresAt <= new Date()) {
    throw new Error("Promo code has expired");
  }

  if (promo.usedCount >= promo.maxUses) {
    throw new Error("Promo usage limit reached");
  }

  if (subtotalAmount < promo.minOrderValue) {
    throw new Error(`Minimum order value for this promo is Rs.${promo.minOrderValue}`);
  }

  const discountAmount = Number(((subtotalAmount * promo.discountPercent) / 100).toFixed(2));
  return { promo, discountAmount };
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
      return res.status(409).json({ error: "Email is already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await models.User.create({ name, email, passwordHash, mobileNumber: null });

    req.session.user = { id: String(user._id), name: user.name, email: user.email, mobileNumber: user.mobileNumber || "" };

    runInBackground(
      () => withTimeout(sendWelcomeEmail({ toEmail: user.email, customerName: user.name }), 15000, "Welcome email"),
      "Signup succeeded but welcome email failed"
    );

    res.status(201).json({ user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Signup failed" });
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

    req.session.user = { id: String(user._id), name: user.name, email: user.email, mobileNumber: user.mobileNumber || "" };
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

  const exists = await models.User.exists({ email });
  return res.json({ available: !exists });
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

    const existing = await models.User.findOne({ email, _id: { $ne: userId } }).lean();
    if (existing) {
      return res.status(409).json({ error: "Email is already in use by another account" });
    }

    const user = await models.User.findByIdAndUpdate(
      userId,
      { $set: { name, email, mobileNumber: mobileNumber || null } },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    req.session.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      mobileNumber: user.mobileNumber || ""
    };

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

app.post("/api/admin/login", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || "admin@myfarms.com");
  const adminPassword = String(process.env.ADMIN_PASSWORD || "admin123");

  if (email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  req.session.admin = { email: adminEmail };
  res.json({ admin: req.session.admin });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.admin = null;
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  res.json({ admin: req.session.admin || null });
});

app.get("/api/admin/products", requireAdmin, async (_req, res) => {
  const products = await models.Product.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      category: p.category,
      price: p.price,
      unit: p.unit,
      imagePath: p.imagePath || null,
      stock: p.stock || 0,
      featured: Boolean(p.featured),
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

app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  uploadImage.single("image")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "Image upload failed" });

    try {
      const product = await models.Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: "Product not found" });

      const nextName = String(req.body.name ?? product.name).trim();
      const nextCategory = String(req.body.category ?? product.category).trim();
      const nextUnit = String(req.body.unit ?? product.unit).trim();
      const nextPrice = req.body.price === undefined ? product.price : Number(req.body.price);
      const nextStock = req.body.stock === undefined ? product.stock : Number(req.body.stock);
      const nextFeatured = String(req.body.featured ?? product.featured) === "true";
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

      product.name = nextName;
      product.category = nextCategory;
      product.unit = nextUnit;
      product.price = nextPrice;
      product.stock = nextStock;
      product.featured = nextFeatured;
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

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const result = await models.Product.deleteOne({ _id: req.params.id });
  if (!result.deletedCount) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});

app.patch("/api/admin/products/:id/stock-flag", requireAdmin, async (req, res) => {
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

app.post("/api/admin/products/:id/variants", requireAdmin, async (req, res) => {
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

app.put("/api/admin/products/:id/variants/:variantId", requireAdmin, async (req, res) => {
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

app.delete("/api/admin/products/:id/variants/:variantId", requireAdmin, async (req, res) => {
  const product = await models.Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const variant = product.variants.id(req.params.variantId);
  if (!variant) return res.status(404).json({ error: "Variant not found" });

  variant.deleteOne();
  product.isVariantParent = product.variants.length > 0;
  await product.save();
  res.json({ ok: true });
});

app.get("/api/admin/promos", requireAdmin, async (_req, res) => {
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
      active: p.active
    }))
  });
});

app.post("/api/admin/promos", requireAdmin, async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const discountPercent = Number(req.body.discountPercent);
  const minOrderValue = Number(req.body.minOrderValue || 0);
  const maxUses = Number(req.body.maxUses || 100);
  const expiresAt = new Date(req.body.expiresAt);

  if (!/^[A-Z0-9]{4,20}$/.test(code)) return res.status(400).json({ error: "Promo code must be 4-20 alphanumeric" });
  if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 90) {
    return res.status(400).json({ error: "Discount percent must be between 1 and 90" });
  }
  if (!Number.isFinite(minOrderValue) || minOrderValue < 0) return res.status(400).json({ error: "Invalid minimum order value" });
  if (!Number.isInteger(maxUses) || maxUses < 1) return res.status(400).json({ error: "maxUses must be at least 1" });
  if (Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: "Invalid expiry date" });

  try {
    await models.PromoCode.create({ code, discountPercent, minOrderValue, maxUses, expiresAt, active: true });
    res.status(201).json({ ok: true });
  } catch (promoErr) {
    if (promoErr.code === 11000) return res.status(409).json({ error: "Promo code already exists" });
    res.status(500).json({ error: "Could not create promo code" });
  }
});

app.patch("/api/admin/promos/:id", requireAdmin, async (req, res) => {
  const update = {};
  if (req.body.active !== undefined) update.active = Boolean(req.body.active);
  if (req.body.expiresAt !== undefined) {
    const d = new Date(req.body.expiresAt);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid expiry date" });
    update.expiresAt = d;
  }

  const result = await models.PromoCode.updateOne({ _id: req.params.id }, { $set: update });
  if (!result.matchedCount) return res.status(404).json({ error: "Promo not found" });
  res.json({ ok: true });
});

app.delete("/api/admin/promos/:id", requireAdmin, async (req, res) => {
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

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
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
    imagePath: p.imagePath || null,
      stock: p.stock || 0,
      featured: Boolean(p.featured),
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

app.post("/api/admin/products", requireAdmin, (req, res) => {
  uploadImage.single("image")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Image upload failed" });
    }

    try {
      const name = String(req.body.name || "").trim();
      const category = String(req.body.category || "").trim();
      const unit = String(req.body.unit || "").trim() || "kg";
      const price = Number(req.body.price);
      const stock = Number(req.body.stock ?? 0);
      const featured = String(req.body.featured || "false") === "true";
      const forceOutOfStock = String(req.body.forceOutOfStock || "false") === "true";
      const rawVariants = String(req.body.variantsJson || "[]");
      let variantsPayload = [];

      if (!name || !category || !Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: "Name, category, and valid price are required" });
      }
      if (!Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ error: "Stock must be a non-negative integer" });
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
        price,
        stock,
        featured,
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
    const { items, paymentMethod, address, fullName, contactNumber, tipAmount, promoCode } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cart items are required" });
    }

    if (!["COD", "PICKUP"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Invalid payment method" });
    }

    if (paymentMethod === "COD" && (!address || String(address).trim().length < 8)) {
      return res.status(400).json({ error: "Valid delivery address is required for COD" });
    }
    if (!fullName || String(fullName).trim().length < 2) {
      return res.status(400).json({ error: "Full name is required" });
    }
    if (!isValidContactNumber(contactNumber)) {
      return res.status(400).json({ error: "Please enter a valid 10-digit mobile number" });
    }
    const parsedTip = Number(tipAmount || 0);
    if (!Number.isFinite(parsedTip) || parsedTip < 0 || parsedTip > 5000) {
      return res.status(400).json({ error: "Tip amount must be between 0 and 5000" });
    }

    const resolvedItems = [];
    let subtotalAmount = 0;

    for (const rawItem of items) {
      const product = await models.Product.findById(rawItem.productId).lean();
      if (!product) {
        return res.status(400).json({ error: `Invalid product ${rawItem.productId}` });
      }
      if (product.forceOutOfStock) {
        return res.status(400).json({ error: `${product.name} is currently out of stock` });
      }

      const quantity = Number(rawItem.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.status(400).json({ error: "Invalid quantity" });
      }

      let unitPrice = Number(product.price);
      let variantName = null;
      let variantRef = null;

      if (product.variants && product.variants.length && !rawItem.variant) {
        return res.status(400).json({ error: `Please choose a variant for ${product.name}` });
      }

      if (rawItem.variant) {
        const variant = (product.variants || []).find((v) => v.name === rawItem.variant);
        if (!variant) {
          return res.status(400).json({ error: `Invalid variant for product ${product.name}` });
        }

        variantName = variant.name;
        unitPrice = Number(variant.price);
        variantRef = variant;

        if (Number(variant.stock || 0) < quantity) {
          return res.status(400).json({ error: `${product.name} (${variant.name}) is out of stock` });
        }
      } else if (Number(product.stock || 0) < quantity) {
        return res.status(400).json({ error: `${product.name} is out of stock` });
      }

      const subtotal = unitPrice * quantity;
      subtotalAmount += subtotal;

      resolvedItems.push({
        productId: product._id,
        name: product.name,
        variant: variantName,
        variantId: variantRef && variantRef._id ? String(variantRef._id) : null,
        quantity,
        unitPrice,
        subtotal
      });
    }

    const user = req.session.user;
    const finalAddress = paymentMethod === "PICKUP" ? "Store Pickup" : address.trim();
    const normalizedFullName = String(fullName).trim();
    const normalizedContactNumber = String(contactNumber).trim();
    const normalizedPromoCode = String(promoCode || "").trim();
    const { promo, discountAmount } = await validatePromoCode({ promoCode: normalizedPromoCode, subtotalAmount });
    const taxableAmount = Number((subtotalAmount - discountAmount).toFixed(2));
    const taxAmount = Number((taxableAmount * TAX_RATE).toFixed(2));

    const finalTotal = Number((taxableAmount + taxAmount + parsedTip).toFixed(2));
    const order = await models.Order.create({
      userId: user.id,
      customerName: normalizedFullName,
      customerEmail: user.email,
      customerPhone: normalizedContactNumber,
      tipAmount: Number(parsedTip.toFixed(2)),
      deliveryAddress: finalAddress,
      paymentMethod,
      subtotalAmount: Number(subtotalAmount.toFixed(2)),
      promoCode: promo ? promo.code : null,
      discountAmount,
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
      customerEmail: user.email,
      customerPhone: normalizedContactNumber,
      tipAmount: Number(parsedTip.toFixed(2)),
      paymentMethod,
      address: finalAddress,
      items: resolvedItems,
      subtotalAmount: Number(subtotalAmount.toFixed(2)),
      promoCode: promo ? promo.code : null,
      discountAmount,
      taxAmount,
      totalAmount: finalTotal.toFixed(2)
    };

    for (const item of resolvedItems) {
      if (item.variantId) {
        await models.Product.updateOne(
          { _id: item.productId, "variants._id": item.variantId },
          {
            $inc: {
              "variants.$.stock": -item.quantity,
              orderCount: item.quantity
            }
          }
        );
      } else {
        await models.Product.updateOne(
          { _id: item.productId },
          {
            $inc: {
              stock: -item.quantity,
              orderCount: item.quantity
            }
          }
        );
      }
    }

    if (promo) {
      await models.PromoCode.updateOne({ _id: promo._id }, { $inc: { usedCount: 1 } });
    }

    res.status(201).json({
      orderId: String(order._id),
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
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
    console.error(err);
    res.status(500).json({ error: "Could not create order" });
  }
});

app.get("/api/orders/my", requireAuth, async (req, res) => {
  await cleanupOldOrders();
  const orders = await models.Order.find({ userId: req.session.user.id })
    .sort({ createdAt: -1 })
    .select("deliveryAddress paymentMethod subtotalAmount discountAmount taxAmount tipAmount totalAmount status cancelNote createdAt promoCode items")
    .lean();

  res.json({
    orders: orders.map((o) => ({
      id: String(o._id),
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

app.get("/api/admin/orders", requireAdmin, async (_req, res) => {
  await cleanupOldOrders();
  const dateFrom = parseDateInput(_req.query.dateFrom);
  const dateTo = parseDateInput(_req.query.dateTo, true);
  const status = String(_req.query.status || "").trim();
  const category = String(_req.query.category || "").trim();

  const query = {};
  if (status) query.status = status;
  else query.status = { $ne: "DELIVERED" };
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = dateFrom;
    if (dateTo) query.createdAt.$lte = dateTo;
  }

  let orders = await models.Order.find(query)
    .sort({ createdAt: -1 })
    .select("customerName customerEmail customerPhone deliveryAddress paymentMethod subtotalAmount discountAmount taxAmount tipAmount totalAmount status cancelNote createdAt items promoCode")
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

app.get("/api/admin/complaints", requireAdmin, async (req, res) => {
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

app.post("/api/admin/complaints/:id/reply", requireAdmin, async (req, res) => {
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

app.patch("/api/admin/orders/:id/status", requireAdmin, updateOrderStatusHandler);
app.post("/api/admin/orders/:id/status", requireAdmin, updateOrderStatusHandler);

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
