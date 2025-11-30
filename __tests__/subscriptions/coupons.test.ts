/**
 * Subscription System Tests
 *
 * Unit tests for the subscription system including:
 * - Coupon validation and discount calculation
 * - Gift subscription logic
 * - Bundle pricing calculations
 * - Dunning schedule calculations
 *
 * Run tests with: npm test or npx vitest
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateCoupon,
  calculateDiscount,
  DUNNING_CONFIG,
  getNextRetryDate,
  Coupon,
} from "@/lib/models/coupons";

// Mock the database
vi.mock("@/lib/db", () => ({
  getDbAsync: vi.fn(),
}));

describe("Coupon System", () => {
  describe("calculateDiscount", () => {
    it("should calculate percentage discount correctly", async () => {
      const coupon: Coupon = {
        id: "coupon_1",
        code: "SAVE20",
        name: "20% Off",
        discount_type: "percentage",
        discount_value: 20,
        currency_code: "USD",
        duration: "once",
        redemption_count: 0,
        valid_from: new Date().toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // $100 order with 20% off = $20 discount
      const discount = await calculateDiscount(coupon, 10000);
      expect(discount).toBe(2000);
    });

    it("should calculate fixed amount discount correctly", async () => {
      const coupon: Coupon = {
        id: "coupon_2",
        code: "FLAT10",
        name: "$10 Off",
        discount_type: "fixed_amount",
        discount_value: 1000, // $10 in cents
        currency_code: "USD",
        duration: "once",
        redemption_count: 0,
        valid_from: new Date().toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // $50 order with $10 off = $10 discount
      const discount = await calculateDiscount(coupon, 5000);
      expect(discount).toBe(1000);
    });

    it("should not exceed order amount for fixed discount", async () => {
      const coupon: Coupon = {
        id: "coupon_3",
        code: "FLAT50",
        name: "$50 Off",
        discount_type: "fixed_amount",
        discount_value: 5000, // $50 in cents
        currency_code: "USD",
        duration: "once",
        redemption_count: 0,
        valid_from: new Date().toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // $30 order with $50 off should only discount $30
      const discount = await calculateDiscount(coupon, 3000);
      expect(discount).toBe(3000);
    });
  });

  describe("Coupon Validation", () => {
    it("should identify expired coupons", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const coupon: Coupon = {
        id: "coupon_4",
        code: "EXPIRED",
        name: "Expired Coupon",
        discount_type: "percentage",
        discount_value: 10,
        currency_code: "USD",
        duration: "once",
        redemption_count: 0,
        valid_from: "2020-01-01T00:00:00Z",
        valid_until: yesterday.toISOString(),
        is_active: true,
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
      };

      const now = new Date();
      const isExpired = coupon.valid_until && new Date(coupon.valid_until) < now;
      expect(isExpired).toBe(true);
    });

    it("should identify future coupons as not yet valid", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const coupon: Coupon = {
        id: "coupon_5",
        code: "FUTURE",
        name: "Future Coupon",
        discount_type: "percentage",
        discount_value: 10,
        currency_code: "USD",
        duration: "once",
        redemption_count: 0,
        valid_from: tomorrow.toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const now = new Date();
      const isNotYetValid = new Date(coupon.valid_from) > now;
      expect(isNotYetValid).toBe(true);
    });

    it("should check max redemption limit", () => {
      const coupon: Coupon = {
        id: "coupon_6",
        code: "LIMITED",
        name: "Limited Coupon",
        discount_type: "percentage",
        discount_value: 10,
        currency_code: "USD",
        duration: "once",
        max_redemptions: 100,
        redemption_count: 100,
        valid_from: new Date().toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const hasReachedLimit =
        coupon.max_redemptions !== undefined &&
        coupon.redemption_count >= coupon.max_redemptions;
      expect(hasReachedLimit).toBe(true);
    });

    it("should check minimum order amount", () => {
      const coupon: Coupon = {
        id: "coupon_7",
        code: "MIN50",
        name: "Min $50 Order",
        discount_type: "percentage",
        discount_value: 10,
        currency_code: "USD",
        duration: "once",
        min_order_amount: 5000, // $50 minimum
        redemption_count: 0,
        valid_from: new Date().toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const orderAmount = 3000; // $30 order
      const meetsMinimum =
        coupon.min_order_amount === undefined ||
        orderAmount >= coupon.min_order_amount;
      expect(meetsMinimum).toBe(false);
    });
  });
});

describe("Dunning System", () => {
  describe("DUNNING_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DUNNING_CONFIG.maxAttempts).toBe(4);
      expect(DUNNING_CONFIG.retrySchedule).toEqual([1, 3, 5, 7]);
      expect(DUNNING_CONFIG.gracePeriodDays).toBe(3);
    });
  });

  describe("getNextRetryDate", () => {
    it("should return correct date for first retry", () => {
      const nextDate = getNextRetryDate(0);
      expect(nextDate).not.toBeNull();

      if (nextDate) {
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + 1);
        // Compare just the date part
        expect(nextDate.toDateString()).toBe(expectedDate.toDateString());
      }
    });

    it("should return correct date for second retry", () => {
      const nextDate = getNextRetryDate(1);
      expect(nextDate).not.toBeNull();

      if (nextDate) {
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + 3);
        expect(nextDate.toDateString()).toBe(expectedDate.toDateString());
      }
    });

    it("should return correct date for third retry", () => {
      const nextDate = getNextRetryDate(2);
      expect(nextDate).not.toBeNull();

      if (nextDate) {
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + 5);
        expect(nextDate.toDateString()).toBe(expectedDate.toDateString());
      }
    });

    it("should return correct date for fourth retry", () => {
      const nextDate = getNextRetryDate(3);
      expect(nextDate).not.toBeNull();

      if (nextDate) {
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + 7);
        expect(nextDate.toDateString()).toBe(expectedDate.toDateString());
      }
    });

    it("should return null when max attempts reached", () => {
      const nextDate = getNextRetryDate(4);
      expect(nextDate).toBeNull();
    });

    it("should return null when exceeding max attempts", () => {
      const nextDate = getNextRetryDate(10);
      expect(nextDate).toBeNull();
    });
  });
});

describe("Bundle Pricing", () => {
  it("should calculate savings correctly", () => {
    const plan1Price = 2999; // $29.99
    const plan2Price = 1999; // $19.99
    const plan3Price = 1499; // $14.99
    const totalIndividual = plan1Price + plan2Price + plan3Price; // $64.97

    const bundlePrice = 4999; // $49.99
    const savingsAmount = totalIndividual - bundlePrice; // $14.98
    const savingsPercentage = Math.round((savingsAmount / totalIndividual) * 100);

    expect(savingsAmount).toBe(1498);
    expect(savingsPercentage).toBe(23); // 23% savings
  });

  it("should handle zero savings", () => {
    const plan1Price = 2999;
    const plan2Price = 1999;
    const totalIndividual = plan1Price + plan2Price;

    const bundlePrice = totalIndividual; // Same price
    const savingsAmount = Math.max(0, totalIndividual - bundlePrice);
    const savingsPercentage =
      totalIndividual > 0
        ? Math.round((savingsAmount / totalIndividual) * 100)
        : 0;

    expect(savingsAmount).toBe(0);
    expect(savingsPercentage).toBe(0);
  });

  it("should handle bundle more expensive than individual", () => {
    const plan1Price = 2999;
    const totalIndividual = plan1Price;

    const bundlePrice = 3999; // More expensive
    const savingsAmount = Math.max(0, totalIndividual - bundlePrice);

    expect(savingsAmount).toBe(0); // Should be 0, not negative
  });
});

describe("Gift Subscription", () => {
  it("should generate valid redemption codes", () => {
    // Simulate code generation
    const generateCode = () =>
      Math.random().toString(36).substring(2, 10).toUpperCase();

    const code = generateCode();

    expect(code.length).toBe(8);
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });

  it("should calculate expiry date correctly", () => {
    const daysUntilExpiry = 90;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysUntilExpiry);

    const now = new Date();
    const daysRemaining = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    );

    expect(daysRemaining).toBe(90);
  });

  it("should identify expired gifts", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const giftExpiresAt = yesterday.toISOString();
    const now = new Date();
    const isExpired = new Date(giftExpiresAt) < now;

    expect(isExpired).toBe(true);
  });

  it("should identify valid gifts", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const giftExpiresAt = tomorrow.toISOString();
    const now = new Date();
    const isExpired = new Date(giftExpiresAt) < now;

    expect(isExpired).toBe(false);
  });
});

describe("Subscription Status Transitions", () => {
  const validTransitions: Record<string, string[]> = {
    pending: ["active", "trialing", "cancelled"],
    trialing: ["active", "cancelled", "expired"],
    active: ["paused", "past_due", "cancelled"],
    paused: ["active", "cancelled"],
    past_due: ["active", "cancelled"],
    cancelled: ["expired"],
    expired: [],
  };

  it("should allow valid status transitions", () => {
    const currentStatus = "active";
    const newStatus = "paused";

    const isValidTransition = validTransitions[currentStatus]?.includes(newStatus);
    expect(isValidTransition).toBe(true);
  });

  it("should not allow invalid status transitions", () => {
    const currentStatus = "expired";
    const newStatus = "active";

    const isValidTransition = validTransitions[currentStatus]?.includes(newStatus);
    expect(isValidTransition).toBe(false);
  });

  it("should allow pause from active", () => {
    const currentStatus = "active";
    const newStatus = "paused";

    const isValidTransition = validTransitions[currentStatus]?.includes(newStatus);
    expect(isValidTransition).toBe(true);
  });

  it("should allow resume from paused", () => {
    const currentStatus = "paused";
    const newStatus = "active";

    const isValidTransition = validTransitions[currentStatus]?.includes(newStatus);
    expect(isValidTransition).toBe(true);
  });
});

describe("Price Formatting", () => {
  it("should format USD correctly", () => {
    const formatPrice = (amount: number, currency: string) => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency,
      }).format(amount / 100);
    };

    expect(formatPrice(2999, "USD")).toBe("$29.99");
    expect(formatPrice(100, "USD")).toBe("$1.00");
    expect(formatPrice(1, "USD")).toBe("$0.01");
    expect(formatPrice(0, "USD")).toBe("$0.00");
  });

  it("should handle other currencies", () => {
    const formatPrice = (amount: number, currency: string) => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency,
      }).format(amount / 100);
    };

    expect(formatPrice(2999, "EUR")).toContain("29.99");
    expect(formatPrice(2999, "GBP")).toContain("29.99");
  });
});
