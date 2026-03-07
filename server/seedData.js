const products = [
  // Fruits
  { name: "Mango", category: "Fruits", price: 120, unit: "kg", isVariantParent: 1 },
  { name: "Guava", category: "Fruits", price: 60, unit: "kg", isVariantParent: 0 },
  { name: "Chikoo (Sapota)", category: "Fruits", price: 70, unit: "kg", isVariantParent: 0 },
  { name: "Watermelon", category: "Fruits", price: 35, unit: "kg", isVariantParent: 0 },
  { name: "Jackfruit", category: "Fruits", price: 90, unit: "kg", isVariantParent: 0 },
  { name: "Dragon Fruit", category: "Fruits", price: 140, unit: "kg", isVariantParent: 0 },
  { name: "Banana", category: "Fruits", price: 50, unit: "dozen", isVariantParent: 0 },
  { name: "Papaya", category: "Fruits", price: 45, unit: "kg", isVariantParent: 0 },
  { name: "Pear", category: "Fruits", price: 110, unit: "kg", isVariantParent: 0 },
  { name: "Custard Apple", category: "Fruits", price: 95, unit: "kg", isVariantParent: 0 },
  { name: "Jamun", category: "Fruits", price: 130, unit: "kg", isVariantParent: 0 },
  { name: "Coconut", category: "Fruits", price: 35, unit: "piece", isVariantParent: 1 },
  { name: "Ice Apple", category: "Fruits", price: 60, unit: "pack", isVariantParent: 0 },

  // Vegetables
  { name: "Carrot", category: "Vegetables", price: 40, unit: "kg", isVariantParent: 0 },
  { name: "Bottle Gourd", category: "Vegetables", price: 30, unit: "kg", isVariantParent: 0 },
  { name: "Bitter Gourd", category: "Vegetables", price: 45, unit: "kg", isVariantParent: 0 },
  { name: "Ridge Gourd", category: "Vegetables", price: 38, unit: "kg", isVariantParent: 0 },
  { name: "Pumpkin", category: "Vegetables", price: 28, unit: "kg", isVariantParent: 0 },
  { name: "Cucumber", category: "Vegetables", price: 35, unit: "kg", isVariantParent: 0 },
  { name: "Spinach", category: "Vegetables", price: 20, unit: "bunch", isVariantParent: 0 },
  { name: "Tomatoes", category: "Vegetables", price: 32, unit: "kg", isVariantParent: 0 },
  { name: "Sweet Corn", category: "Vegetables", price: 45, unit: "pack", isVariantParent: 0 },
  { name: "Beetroot", category: "Vegetables", price: 42, unit: "kg", isVariantParent: 0 },
  { name: "Potato", category: "Vegetables", price: 30, unit: "kg", isVariantParent: 0 },
  { name: "Onion", category: "Vegetables", price: 36, unit: "kg", isVariantParent: 0 },
  { name: "Green Chilli", category: "Vegetables", price: 55, unit: "kg", isVariantParent: 0 },
  { name: "Brinjal", category: "Vegetables", price: 34, unit: "kg", isVariantParent: 0 },
  { name: "Cabbage", category: "Vegetables", price: 26, unit: "kg", isVariantParent: 0 },
  { name: "Cauliflower", category: "Vegetables", price: 30, unit: "piece", isVariantParent: 0 },
  { name: "Radish", category: "Vegetables", price: 28, unit: "kg", isVariantParent: 0 },
  { name: "Long Egg Plant", category: "Vegetables", price: 40, unit: "kg", isVariantParent: 0 },
  { name: "Okra/Bendi", category: "Vegetables", price: 48, unit: "kg", isVariantParent: 0 },
  { name: "Red Chilli", category: "Vegetables", price: 120, unit: "kg", isVariantParent: 0 },
  { name: "Tamarind", category: "Vegetables", price: 100, unit: "kg", isVariantParent: 0 },

  // Dairy
  { name: "Fresh Milk", category: "Dairy", price: 60, unit: "liter", isVariantParent: 0 },
  { name: "Eggs", category: "Dairy", price: 75, unit: "dozen", isVariantParent: 0 },
  { name: "Ghee", category: "Dairy", price: 620, unit: "liter", isVariantParent: 0 },
  { name: "Butter", category: "Dairy", price: 260, unit: "500g", isVariantParent: 0 },
  { name: "Paneer", category: "Dairy", price: 320, unit: "kg", isVariantParent: 0 },
  { name: "Yogurt", category: "Dairy", price: 85, unit: "kg", isVariantParent: 0 },

  // Meat
  { name: "Broiler Chicken", category: "Meat", price: 260, unit: "kg", isVariantParent: 0 },
  { name: "Natu Kodi Chicken", category: "Meat", price: 420, unit: "kg", isVariantParent: 0 },
  { name: "Mutton", category: "Meat", price: 780, unit: "kg", isVariantParent: 0 },
  { name: "Fish", category: "Meat", price: 320, unit: "kg", isVariantParent: 0 },

  // Oil
  { name: "Organic Groundnut Oil (Bull Driven)", category: "Oil", price: 420, unit: "liter", isVariantParent: 0 }
];

const variants = {
  Mango: [
    { name: "Banganapalli", price: 130 },
    { name: "Nellam", price: 125 },
    { name: "Himsagar", price: 150 },
    { name: "Imampasand", price: 180 },
    { name: "Kesar", price: 165 },
    { name: "Cheruku Rasam", price: 145 }
  ],
  Coconut: [
    { name: "Raw Coconut", price: 35 },
    { name: "Semi Husked Coconut", price: 38 },
    { name: "Yellow Coconut", price: 45 }
  ]
};

module.exports = { products, variants };
