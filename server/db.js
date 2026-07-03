const mongoose = require("mongoose");
const { products, variants } = require("./seedData");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    mobileNumber: { type: String, default: null },
    passwordHash: { type: String, required: true },
    isEmailVerified: { type: Boolean, default: true },
    emailVerificationCodeHash: { type: String, default: null },
    emailVerificationExpiresAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null },
    resetTokenExpiresAt: { type: Date, default: null },
    walletCoins: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true },
    unit: { type: String, required: true },
    description: { type: String, default: "", trim: true, maxlength: 200 },
    imagePath: { type: String, default: null },
    stock: { type: Number, default: 100, min: 0 },
    featured: { type: Boolean, default: false },
    signatureShowcase: { type: Boolean, default: false },
    orderCount: { type: Number, default: 0 },
    forceOutOfStock: { type: Boolean, default: false },
    isVariantParent: { type: Boolean, default: false },
    variants: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
        stock: { type: Number, default: 100, min: 0 }
      }
    ]
  },
  { timestamps: true }
);

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true },
    variantName: { type: String, default: null },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true },
    subtotal: { type: Number, required: true }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    tipAmount: { type: Number, default: 0 },
    deliveryAddress: { type: String, required: true },
    paymentMethod: { type: String, enum: ["COD", "PICKUP"], required: true },
    subtotalAmount: { type: Number, default: 0 },
    promoCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 },
    walletCoinsRedeemed: { type: Number, default: 0, min: 0 },
    walletDiscountAmount: { type: Number, default: 0, min: 0 },
    coinsEarned: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    status: { type: String, default: "PLACED" },
    cancelNote: { type: String, default: null },
    modifiedAt: { type: Date, default: null },
    modifiedCount: { type: Number, default: 0, min: 0 },
    deliveryEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "AdministrativeEmployee", default: null },
    deliveryAssignedBy: { type: String, default: null },
    deliveryAssignedAt: { type: Date, default: null },
    deliveryAcceptedAt: { type: Date, default: null },
    deliveryCompletedAt: { type: Date, default: null },
    deliveryCanceledAt: { type: Date, default: null },
    deliveryCancelNote: { type: String, default: null },
    items: [orderItemSchema]
  },
  { timestamps: true }
);

const promoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountPercent: { type: Number, required: true, min: 1, max: 90 },
    minOrderValue: { type: Number, default: 0, min: 0 },
    maxUses: { type: Number, default: 100, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
    active: { type: Boolean, default: true },
    showOnHomepage: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    type: { type: String, enum: ["EARN", "REDEEM"], required: true },
    coins: { type: Number, required: true },
    description: { type: String, required: true, trim: true },
    balanceAfter: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

const complaintSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    orderNumber: { type: String, required: true, trim: true },
    issue: { type: String, required: true, trim: true },
    proofImagePath: { type: String, default: null },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN" },
    adminReply: { type: String, default: null },
    repliedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

const administrativeEmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    role: { type: String, required: true, trim: true },
    employeePhotoPath: { type: String, default: null },
    aadhaarLast4: { type: String, required: true },
    aadhaarHash: { type: String, required: true },
    passwordHash: { type: String, required: true },
    permissions: [{ type: String, required: true }],
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Product = mongoose.models.Product || mongoose.model("Product", productSchema);
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
const PromoCode = mongoose.models.PromoCode || mongoose.model("PromoCode", promoCodeSchema);
const WalletTransaction = mongoose.models.WalletTransaction || mongoose.model("WalletTransaction", walletTransactionSchema);
const Complaint = mongoose.models.Complaint || mongoose.model("Complaint", complaintSchema);
const AdministrativeEmployee =
  mongoose.models.AdministrativeEmployee || mongoose.model("AdministrativeEmployee", administrativeEmployeeSchema);

async function seedProductsIfNeeded() {
  for (const p of products) {
    const payload = {
      name: p.name,
      category: p.category,
      price: p.price,
      unit: p.unit,
      imagePath: null,
      stock: 100,
      featured: false,
      orderCount: 0,
      forceOutOfStock: false,
      isVariantParent: Boolean(p.isVariantParent),
      variants: (variants[p.name] || []).map((v) => ({ name: v.name, price: v.price, stock: 100 }))
    };

    await Product.updateOne({ name: p.name }, { $setOnInsert: payload }, { upsert: true });
  }
}

async function initDb() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/myfarms";
  await mongoose.connect(mongoUri);
  await seedProductsIfNeeded();
  await Product.updateMany({ stock: { $exists: false } }, { $set: { stock: 100 } });
  await Product.updateMany({ featured: { $exists: false } }, { $set: { featured: false } });
  await Product.updateMany({ signatureShowcase: { $exists: false } }, { $set: { signatureShowcase: false } });
  await Product.updateMany({ description: { $exists: false } }, { $set: { description: "" } });
  await Product.updateMany({ orderCount: { $exists: false } }, { $set: { orderCount: 0 } });
  await Product.updateMany({ forceOutOfStock: { $exists: false } }, { $set: { forceOutOfStock: false } });
  await User.updateMany({ walletCoins: { $exists: false } }, { $set: { walletCoins: 0 } });
  await PromoCode.updateMany({ showOnHomepage: { $exists: false } }, { $set: { showOnHomepage: false } });
  await Product.updateMany(
    {},
    [
      {
        $set: {
          variants: {
            $map: {
              input: "$variants",
              as: "v",
              in: {
                _id: "$$v._id",
                name: "$$v.name",
                price: "$$v.price",
                stock: { $ifNull: ["$$v.stock", 100] }
              }
            }
          }
        }
      }
    ]
  );
}

module.exports = {
  initDb,
  models: { User, Product, Order, PromoCode, WalletTransaction, Complaint, AdministrativeEmployee }
};
