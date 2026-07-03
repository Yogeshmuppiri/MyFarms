class OrderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderValidationError";
    this.statusCode = 400;
  }
}

function failOrderValidation(message) {
  throw new OrderValidationError(message);
}

function isValidContactNumber(contactNumber) {
  return /^\d{10}$/.test(String(contactNumber || "").trim());
}

function calculateEarnedCoins(amount) {
  const eligibleAmount = Math.max(0, Number(amount || 0));
  return Math.floor(eligibleAmount / 50);
}

function calculateWalletDiscountFromCoins(coins) {
  return Math.floor(Math.max(0, Number(coins || 0)) / 50);
}

function validateOrderRequest({ items, paymentMethod, address, fullName, contactNumber, tipAmount }) {
  if (!Array.isArray(items) || items.length === 0) {
    failOrderValidation("Cart items are required");
  }

  if (!["COD", "PICKUP"].includes(paymentMethod)) {
    failOrderValidation("Invalid payment method");
  }

  if (paymentMethod === "COD" && (!address || String(address).trim().length < 8)) {
    failOrderValidation("Valid delivery address is required for COD");
  }

  if (!fullName || String(fullName).trim().length < 2) {
    failOrderValidation("Full name is required");
  }

  if (!isValidContactNumber(contactNumber)) {
    failOrderValidation("Please enter a valid 10-digit mobile number");
  }

  const parsedTip = Number(tipAmount || 0);
  if (!Number.isFinite(parsedTip) || parsedTip < 0 || parsedTip > 5000) {
    failOrderValidation("Tip amount must be between 0 and 5000");
  }

  return { parsedTip };
}

function resolveOrderItem(rawItem, product) {
  if (!product) {
    failOrderValidation(`Invalid product ${rawItem && rawItem.productId}`);
  }

  if (product.forceOutOfStock) {
    failOrderValidation(`${product.name} is currently out of stock`);
  }

  const quantity = Number(rawItem.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    failOrderValidation("Invalid quantity");
  }

  let unitPrice = Number(product.price);
  let variantName = null;
  let variantId = null;

  if (product.variants && product.variants.length && !rawItem.variant) {
    failOrderValidation(`Please choose a variant for ${product.name}`);
  }

  if (rawItem.variant) {
    const variant = (product.variants || []).find((v) => v.name === rawItem.variant);
    if (!variant) {
      failOrderValidation(`Invalid variant for product ${product.name}`);
    }

    variantName = variant.name;
    unitPrice = Number(variant.price);
    variantId = variant._id ? String(variant._id) : null;

    if (Number(variant.stock || 0) < quantity) {
      failOrderValidation(`${product.name} (${variant.name}) is out of stock`);
    }
  } else if (Number(product.stock || 0) < quantity) {
    failOrderValidation(`${product.name} is out of stock`);
  }

  return {
    productId: product._id,
    name: product.name,
    variant: variantName,
    variantId,
    quantity,
    unitPrice,
    subtotal: unitPrice * quantity
  };
}

function calculateOrderTotals({ subtotalAmount, discountAmount = 0, tipAmount = 0, walletCoins = 0, useWalletCoins = false, taxRate }) {
  const taxableAmount = Number((Number(subtotalAmount || 0) - Number(discountAmount || 0)).toFixed(2));
  const taxAmount = Number((taxableAmount * Number(taxRate || 0)).toFixed(2));
  const grossTotal = Number((taxableAmount + taxAmount + Number(tipAmount || 0)).toFixed(2));
  const walletBalance = Math.max(0, Math.floor(Number(walletCoins || 0)));
  const maxDiscountFromWallet = calculateWalletDiscountFromCoins(walletBalance);
  const walletDiscountAmount = useWalletCoins ? Math.min(maxDiscountFromWallet, Math.floor(grossTotal)) : 0;
  const walletCoinsRedeemed = walletDiscountAmount * 50;
  const finalTotal = Number(Math.max(0, grossTotal - walletDiscountAmount).toFixed(2));
  const coinsEarned = calculateEarnedCoins(Math.max(0, taxableAmount - walletDiscountAmount));

  return {
    taxableAmount,
    taxAmount,
    grossTotal,
    walletBalance,
    walletDiscountAmount,
    walletCoinsRedeemed,
    finalTotal,
    coinsEarned
  };
}

function buildStockUpdate(item) {
  if (item.variantId) {
    return {
      filter: { _id: item.productId, "variants._id": item.variantId },
      update: {
        $inc: {
          "variants.$.stock": -item.quantity,
          orderCount: item.quantity
        }
      }
    };
  }

  return {
    filter: { _id: item.productId },
    update: {
      $inc: {
        stock: -item.quantity,
        orderCount: item.quantity
      }
    }
  };
}

module.exports = {
  buildStockUpdate,
  calculateEarnedCoins,
  calculateOrderTotals,
  calculateWalletDiscountFromCoins,
  isValidContactNumber,
  OrderValidationError,
  resolveOrderItem,
  validateOrderRequest
};
