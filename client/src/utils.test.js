import { afterEach, describe, expect, it, vi } from "vitest";
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
  sanitizePromoCode,
  scoreSpeechProductMatch,
  statusLabel,
  tokenizeSpeechProduct
} from "./utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api", () => {
  it("sends JSON requests with content type and returns parsed data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });

    await expect(api("/api/products", { method: "POST", body: JSON.stringify({ name: "Mango" }) }))
      .resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  it("does not force JSON content type for FormData uploads", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ uploaded: true })
    });
    const formData = new FormData();
    formData.append("name", "Guava");

    await api("/api/admin/products", { method: "POST", body: formData });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/products",
      expect.objectContaining({
        method: "POST",
        body: formData,
        headers: {}
      })
    );
  });

  it("throws a request error with response status and data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid product" })
    });

    await expect(api("/api/products")).rejects.toMatchObject({
      message: "Invalid product",
      status: 400,
      data: { error: "Invalid product" }
    });
  });
});

describe("email validation", () => {
  it("accepts syntactically valid email addresses", () => {
    expect(isValidEmail("customer@example.com")).toBe(true);
    expect(isValidEmail("bad-email")).toBe(false);
  });

  it("allows customer signup only for Gmail and Yahoo addresses", () => {
    expect(isAllowedCustomerEmail("USER@GMAIL.COM")).toBe(true);
    expect(isAllowedCustomerEmail("buyer@yahoo.com")).toBe(true);
    expect(isAllowedCustomerEmail("buyer@outlook.com")).toBe(false);
    expect(isAllowedCustomerEmail("not-an-email")).toBe(false);
  });
});

describe("search and speech helpers", () => {
  it("normalizes product names for loose matching", () => {
    expect(normalizeToken("Organic Groundnut Oil (Bull Driven)")).toBe("organicgroundnutoilbulldriven");
  });

  it("removes shopping command stop words from speech input", () => {
    expect(tokenizeSpeechProduct("please add two kg of fresh milk to cart")).toEqual(["fresh", "milk"]);
    expect(getSpeechProductText("show me tomatoes")).toBe("tomatoes");
  });

  it("parses spoken and numeric quantities", () => {
    expect(parseSpokenNumber("add 12 mangoes")).toBe(12);
    expect(parseSpokenNumber("one hundred twenty")).toBe(120);
    expect(parseSpokenNumber("no amount here")).toBeNull();
  });

  it("scores exact product matches above loose matches", () => {
    const exact = scoreSpeechProductMatch({ name: "Fresh Milk" }, ["fresh", "milk"], "freshmilk");
    const loose = scoreSpeechProductMatch({ name: "Fresh Milk" }, ["milk"], "milk");

    expect(exact).toBeGreaterThan(loose);
    expect(loose).toBeGreaterThan(0);
  });
});

describe("formatting and product asset helpers", () => {
  it("sanitizes promo codes to uppercase alphanumeric text", () => {
    expect(sanitizePromoCode(" farm-10 ")).toBe("FARM10");
  });

  it("resolves local and remote asset URLs", () => {
    expect(resolveAssetUrl("mango fresh.jpg")).toBe("/resources/mango%20fresh.jpg");
    expect(resolveAssetUrl("https://cdn.example.com/mango.jpg")).toBe("https://cdn.example.com/mango.jpg");
    expect(resolveAssetUrl("")).toBe("");
  });

  it("finds product images using known aliases", () => {
    const files = ["groundnutoil.jpg", "tomato.png", "fresh-eggs.jpg"];

    expect(getProductImagePath("Organic Groundnut Oil (Bull Driven)", files)).toBe("/resources/groundnutoil.jpg");
    expect(getProductImagePath("Tomatoes", files)).toBe("/resources/tomato.png");
    expect(getProductImagePath("Unknown Item", files)).toBe("");
  });

  it("returns customer-friendly status labels", () => {
    expect(statusLabel("ASSIGNED")).toBe("Assigned");
    expect(statusLabel("ACCEPTED_BY_DELIVERY")).toBe("Accepted by Delivery");
    expect(statusLabel("OUT_FOR_DELIVERY")).toBe("Out for Delivery");
    expect(statusLabel("ORDER_READY_FOR_PICKUP")).toBe("Order Ready for Pickup");
    expect(statusLabel("PLACED")).toBe("PLACED");
    expect(isDeliveredStatus("DELIVERED")).toBe(true);
    expect(isDeliveredStatus("OUT_FOR_DELIVERY")).toBe(false);
  });

  it("uses category-specific signature produce accent colors", () => {
    expect(getShowcaseAccent("Dairy")).toBe("#d9efe8");
    expect(getShowcaseAccent("Vegetables")).toBe("#d7edc5");
    expect(getShowcaseAccent("Other")).toBe("#f5e6b7");
  });
});
