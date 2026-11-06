import { describe, expect, it } from "vitest";
import {
  applySipModification,
  getModificationEffectiveDate,
  previewSipModification,
  validateDebitDay,
  validateSipAmount,
} from "@/lib/domain/modification-engine";
import { createDemoState } from "./helpers/domain-state";

const DEMO_DATE = "2026-11-12";

describe("SIP modification engine", () => {
  it.each([
    [500, true],
    [25_000, true],
    [499, false],
    [25_001, false],
    [500.5, false],
  ])("validates monthly amount %s", (amount, valid) => {
    const errors = validateSipAmount(amount);
    expect(errors.length === 0).toBe(valid);
  });

  it.each([
    [1, true],
    [28, true],
    [0, false],
    [29, false],
    [10.5, false],
  ])("validates debit day %s", (debitDay, valid) => {
    const errors = validateDebitDay(debitDay);
    expect(errors.length === 0).toBe(valid);
  });

  it("calculates the next-cycle effective date", () => {
    const state = createDemoState();

    expect(
      getModificationEffectiveDate(state.sip, DEMO_DATE, { amount: 6_000 }),
    ).toBe("2026-12-10");
    expect(
      getModificationEffectiveDate(state.sip, DEMO_DATE, { debitDay: 15 }),
    ).toBe("2026-12-15");
    expect(
      getModificationEffectiveDate(state.sip, "2026-11-09", { amount: 6_000 }),
    ).toBe("2026-11-10");
  });

  it("previews a valid change without mutating state", () => {
    const state = createDemoState();
    const before = structuredClone(state);
    const preview = previewSipModification(
      state.sip,
      { amount: 6_000, debitDay: 15 },
      DEMO_DATE,
    );

    expect(preview.status).toBe("PREVIEWED");
    expect(preview.effectiveDate).toBe("2026-12-15");
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.changes).toHaveLength(2);
    expect(state).toEqual(before);
  });

  it("rejects invalid modifications without changing state", () => {
    const state = createDemoState();
    const before = structuredClone(state);
    const result = applySipModification(
      state.sip,
      { amount: 499 },
      DEMO_DATE,
      DEMO_DATE,
    );

    expect(result.applied).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.sip).toBe(state.sip);
    expect(state).toEqual(before);
  });

  it("applies valid amount and debit-day changes while preserving cycles", () => {
    const state = createDemoState();
    const cyclesBefore = structuredClone(state.sip.cycles);
    const result = applySipModification(
      state.sip,
      { amount: 6_000, debitDay: 15 },
      DEMO_DATE,
      DEMO_DATE,
    );

    expect(result.applied).toBe(true);
    expect(result.effectiveDate).toBe("2026-12-15");
    expect(result.sip.monthlyAmount).toBe(6_000);
    expect(result.sip.debitDay).toBe(15);
    expect(result.sip.lastModifiedOn).toBe(DEMO_DATE);
    expect(result.sip.cycles).toEqual(cyclesBefore);
  });
});
