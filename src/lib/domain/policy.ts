/**
 * Fictional demo policy v1.1.
 *
 * These rules exist only for the graduation demonstration and must never be
 * presented as actual Groww policy.
 */
export const demoPolicy = {
  version: "demo-policy-v1.1",
  label: "Fictional demo policy — not Groww policy",
  retryWindowDays: 7,
  maxRetryAttempts: 3,
  minMonthlyAmount: 500,
  maxMonthlyAmount: 25_000,
  minDebitDay: 1,
  maxDebitDay: 28,
  restartWindowDays: 90,
  rewardTargetInstalments: 12,
  rewardVoucherLabel: "₹500 fictional demo voucher",
  rewardVoucherNote: "Simulated reward only. Not redeemable.",
  actionPreviewTtlMinutes: 15,
  demoToday: "2026-11-12",
  demoNow: "2026-11-12T10:00:00.000Z",
} as const;

export type DemoPolicy = typeof demoPolicy;
