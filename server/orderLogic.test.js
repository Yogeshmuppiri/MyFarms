import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildStockUpdate,
  calculateOrderTotals,
  OrderValidationError,
  resolveOrderItem,
  validateOrderRequest
} = require("./orderLogic");

describe("order request validation", () => {
  it("accepts valid COD order basics and parses tip", () => {
    expect(
      validateOrderRequest({
        items: [{ productId: "p1", quantity: 1 }],
        paymentMethod: "COD",
        address: "123 Farm Road",
        fullName: "Yogesh",
        contactNumber: "9876543210",
        tipAmount: "25"
      })
    ).toEqual({ parsedTip: 25 });
  });

  it("rejects invalid customer and payment inputs as order validation errors", () => {
    expect(() =>
      validateOrderRequest({
        items: [],
        paymentMethod: "COD",
        address: "123 Farm Road",
        fullName: "Yogesh",
        contactNumber: "9876543210",
        tipAmount: 0
      })
    ).toThrow(OrderValidationError);

    expect(() =>
      validateOrderRequest({
        items: [{ productId: "p1", quantity: 1 }],
        paymentMethod: "CARD",
        address: "123 Farm Road",
        fullName: "Yogesh",
        contactNumber: "9876543210",
        tipAmount: 0
      })
    ).toThrow("Invalid payment method");

    expect(() =>
      validateOrderRequest({
        items: [{ productId: "p1", quantity: 1 }],
        paymentMethod: "COD",
        address: "short",
        fullName: "Yogesh",
        contactNumber: "9876543210",
        tipAmount: 0
      })
    ).toThrow("Valid delivery address is required for COD");

    expect(() =>
      validateOrderRequest({
        items: [{ productId: "p1", quantity: 1 }],
        paymentMethod: "PICKUP",
        address: "",
        fullName: "Yogesh",
        contactNumber: "98765",
        tipAmount: 0
      })
    ).toThrow("Please enter a valid 10-digit mobile number");
  });

  it("rejects unsafe tip amounts", () => {
    expect(() =>
      validateOrderRequest({
        items: [{ productId: "p1", quantity: 1 }],
        paymentMethod: "PICKUP",
        address: "",
        fullName: "Yogesh",
        contactNumber: "9876543210",
        tipAmount: 5001
      })
    ).toThrow("Tip amount must be between 0 and 5000");
  });
});

describe("cart item resolution", () => {
  const tomato = {
    _id: "product-tomato",
    name: "Tomatoes",
    price: 40,
    stock: 5,
    forceOutOfStock: false,
    variants: []
  };

  const oil = {
    _id: "product-oil",
    name: "Groundnut Oil",
    price: 350,
    stock: 0,
    forceOutOfStock: false,
    variants: [
      { _id: "variant-1l", name: "1L", price: 350, stock: 3 },
      { _id: "variant-5l", name: "5L", price: 1600, stock: 1 }
    ]
  };

  it("resolves simple products and computes line subtotal", () => {
    expect(resolveOrderItem({ productId: tomato._id, quantity: 2 }, tomato)).toEqual({
      productId: "product-tomato",
      name: "Tomatoes",
      variant: null,
      variantId: null,
      quantity: 2,
      unitPrice: 40,
      subtotal: 80
    });
  });

  it("resolves selected variants with variant price and stock", () => {
    expect(resolveOrderItem({ productId: oil._id, quantity: 2, variant: "1L" }, oil)).toMatchObject({
      productId: "product-oil",
      name: "Groundnut Oil",
      variant: "1L",
      variantId: "variant-1l",
      quantity: 2,
      unitPrice: 350,
      subtotal: 700
    });
  });

  it("rejects out-of-stock, force-disabled, invalid quantity, and missing variant cases", () => {
    expect(() => resolveOrderItem({ productId: tomato._id, quantity: 6 }, tomato)).toThrow("Tomatoes is out of stock");
    expect(() => resolveOrderItem({ productId: tomato._id, quantity: 0 }, tomato)).toThrow("Invalid quantity");
    expect(() => resolveOrderItem({ productId: oil._id, quantity: 1 }, oil)).toThrow("Please choose a variant for Groundnut Oil");
    expect(() => resolveOrderItem({ productId: oil._id, quantity: 1, variant: "2L" }, oil)).toThrow(
      "Invalid variant for product Groundnut Oil"
    );
    expect(() =>
      resolveOrderItem({ productId: tomato._id, quantity: 1 }, { ...tomato, forceOutOfStock: true })
    ).toThrow("Tomatoes is currently out of stock");
  });
});

describe("order totals and stock updates", () => {
  it("calculates tax, wallet redemption, final total, and earned coins", () => {
    expect(
      calculateOrderTotals({
        subtotalAmount: 1000,
        discountAmount: 100,
        tipAmount: 25,
        walletCoins: 2500,
        useWalletCoins: true,
        taxRate: 0.05
      })
    ).toEqual({
      taxableAmount: 900,
      taxAmount: 45,
      grossTotal: 970,
      walletBalance: 2500,
      walletDiscountAmount: 50,
      walletCoinsRedeemed: 2500,
      finalTotal: 920,
      coinsEarned: 17
    });
  });

  it("does not redeem wallet coins when disabled and clamps negative wallet balances", () => {
    expect(
      calculateOrderTotals({
        subtotalAmount: 100,
        discountAmount: 0,
        tipAmount: 0,
        walletCoins: -100,
        useWalletCoins: true,
        taxRate: 0.05
      })
    ).toMatchObject({
      walletBalance: 0,
      walletDiscountAmount: 0,
      walletCoinsRedeemed: 0,
      finalTotal: 105,
      coinsEarned: 2
    });
  });

  it("builds product and variant stock decrement updates", () => {
    expect(buildStockUpdate({ productId: "p1", quantity: 3, variantId: null })).toEqual({
      filter: { _id: "p1" },
      update: { $inc: { stock: -3, orderCount: 3 } }
    });

    expect(buildStockUpdate({ productId: "p2", quantity: 2, variantId: "v1" })).toEqual({
      filter: { _id: "p2", "variants._id": "v1" },
      update: { $inc: { "variants.$.stock": -2, orderCount: 2 } }
    });
  });
});
