import { describe, expect, it } from "vitest";
import { createPostgresAssistantTokenBudgetCoordinator } from "@/lib/ai/postgres-token-budget";
import type { PostgresQueryable, PostgresQueryResult } from "@/lib/db/postgres";
import { runAssistant } from "@/lib/ai/pipeline";
import { PAYMENT_QUESTION, READY_CONFIG, fakeModelClient, okResult, validPaymentOutput } from "./fixtures";

interface Reservation {
  max: number;
  settled: number | null;
}

class FakeBudgetDatabase implements PostgresQueryable {
  readonly reservations = new Map<string, Reservation>();
  reserved = 0;
  spent = 0;
  fail = false;

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    if (this.fail) throw new Error("database unavailable");
    let ok = false;
    const id = String(values[0]);
    if (text.includes("reserve_assistant_token_budget")) {
      const max = Number(values[1]);
      if (!this.reservations.has(id) && max <= 100_000 - this.reserved - this.spent) {
        this.reservations.set(id, { max, settled: null });
        this.reserved += max;
        ok = true;
      }
    } else if (text.includes("settle_assistant_token_budget")) {
      const reservation = this.reservations.get(id);
      if (reservation) {
        ok = true;
        if (reservation.settled === null) {
          const actual = values[1] == null ? reservation.max : Number(values[1]);
          reservation.settled = actual;
          this.reserved -= reservation.max;
          this.spent += actual;
        }
      }
    } else {
      throw new Error("unexpected SQL");
    }
    return { rows: [{ ok } as unknown as Row] };
  }
}

const reservationId = (number: number) =>
  `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;

describe("PostgreSQL token budget adapter", () => {
  it("limits concurrent reservations to the shared hourly cap", async () => {
    const database = new FakeBudgetDatabase();
    const coordinator = createPostgresAssistantTokenBudgetCoordinator(database);
    const leases = await Promise.all(Array.from({ length: 150 }, (_, index) =>
      coordinator.reserve({ reservationId: reservationId(index + 1), maxTokens: 1_000, nowMs: 0 }),
    ));
    expect(leases.filter(Boolean)).toHaveLength(100);
    expect(database.reserved).toBe(100_000);
  });

  it("admits concurrent reservations exactly up to the hourly boundary", async () => {
    const database = new FakeBudgetDatabase();
    const coordinator = createPostgresAssistantTokenBudgetCoordinator(database);
    const leases = await Promise.all([
      coordinator.reserve({ reservationId: reservationId(1), maxTokens: 70_000, nowMs: 0 }),
      coordinator.reserve({ reservationId: reservationId(2), maxTokens: 30_000, nowMs: 0 }),
      coordinator.reserve({ reservationId: reservationId(3), maxTokens: 1, nowMs: 0 }),
    ]);

    expect(leases.map(Boolean)).toEqual([true, true, false]);
    expect(database.reserved).toBe(100_000);
    expect(database.reserved + database.spent).toBeLessThanOrEqual(100_000);
  });

  it("rejects duplicate reservation IDs and settles idempotently", async () => {
    const database = new FakeBudgetDatabase();
    const coordinator = createPostgresAssistantTokenBudgetCoordinator(database);
    const lease = await coordinator.reserve({ reservationId: reservationId(1), maxTokens: 500, nowMs: 0 });
    expect(lease).not.toBeNull();
    expect(await coordinator.reserve({ reservationId: reservationId(1), maxTokens: 500, nowMs: 0 })).toBeNull();
    await lease!.settle(120);
    await lease!.settle(null);
    expect(database.reserved).toBe(0);
    expect(database.spent).toBe(120);
  });

  it("charges the full reservation when usage is missing", async () => {
    const database = new FakeBudgetDatabase();
    const coordinator = createPostgresAssistantTokenBudgetCoordinator(database);
    const lease = await coordinator.reserve({ reservationId: reservationId(2), maxTokens: 700, nowMs: 0 });
    await lease!.settle(null);
    expect(database.spent).toBe(700);
    expect(database.reserved).toBe(0);
  });

  it("propagates database errors so callers fail closed", async () => {
    const database = new FakeBudgetDatabase();
    database.fail = true;
    const coordinator = createPostgresAssistantTokenBudgetCoordinator(database);
    await expect(coordinator.reserve({
      reservationId: reservationId(3), maxTokens: 50, nowMs: 0,
    })).rejects.toThrow("database unavailable");
  });

  it("does not call a model when PostgreSQL reservation fails", async () => {
    const database = new FakeBudgetDatabase();
    database.fail = true;
    const modelClient = fakeModelClient([okResult(validPaymentOutput())]);
    const result = await runAssistant(
      { question: PAYMENT_QUESTION, selectedCategory: null },
      {
        env: { NODE_ENV: "production", SHARED_RUNTIME_VERIFIED: "true" },
        config: READY_CONFIG,
        modelClient,
        budgetCoordinator: createPostgresAssistantTokenBudgetCoordinator(database),
        log: () => {},
      },
    );
    expect(modelClient.calls).toHaveLength(0);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.fallbackReason).toBe("MODEL_UNAVAILABLE");
  });

  it("records an observed overrun and withholds the model answer", async () => {
    const database = new FakeBudgetDatabase();
    const modelAnswer = validPaymentOutput().directAnswer;
    const modelClient = fakeModelClient([{
      ...okResult(validPaymentOutput()),
      usage: { inputTokens: 40_000, outputTokens: 10_000, totalTokens: 50_000 },
    }]);
    const result = await runAssistant(
      { question: PAYMENT_QUESTION, selectedCategory: null },
      {
        env: { NODE_ENV: "production", SHARED_RUNTIME_VERIFIED: "true" },
        config: READY_CONFIG,
        modelClient,
        budgetCoordinator: createPostgresAssistantTokenBudgetCoordinator(database),
        demoQuotaCoordinator: {
          scope: "deployment-shared",
          reserve: () => ({ settle: () => {} }),
        },
        log: () => {},
      },
    );

    expect(modelClient.calls).toHaveLength(1);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.directAnswer).not.toBe(modelAnswer);
    expect(result.directAnswer).not.toContain(modelAnswer);
    expect(database.reserved).toBe(0);
    expect(database.spent).toBe(50_000);
    expect([...database.reservations.values()][0]?.max).toBeLessThan(database.spent);
  });
});
