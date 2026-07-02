import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { products, variants } = require("./seedData");

describe("seed product catalogue", () => {
  it("has unique product names", () => {
    const names = products.map((product) => product.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("defines valid product basics for database seeding", () => {
    for (const product of products) {
      expect(product.name).toEqual(expect.any(String));
      expect(product.name.trim()).not.toBe("");
      expect(product.category.trim()).not.toBe("");
      expect(product.unit.trim()).not.toBe("");
      expect(product.price).toBeGreaterThan(0);
      expect([0, 1]).toContain(product.isVariantParent);
    }
  });

  it("keeps variants attached to existing products", () => {
    const productNames = new Set(products.map((product) => product.name));

    for (const [productName, productVariants] of Object.entries(variants)) {
      expect(productNames.has(productName)).toBe(true);
      expect(productVariants.length).toBeGreaterThan(0);
      for (const variant of productVariants) {
        expect(variant.name.trim()).not.toBe("");
        expect(variant.price).toBeGreaterThan(0);
      }
    }
  });
});
