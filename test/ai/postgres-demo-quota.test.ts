import { describe, expect, it } from "vitest";
import { createPostgresAssistantDemoQuotaCoordinator } from "@/lib/ai/postgres-demo-quota";
import { runAssistant } from "@/lib/ai/pipeline";
import type { PostgresQueryable, PostgresQueryResult } from "@/lib/db/postgres";
import { PAYMENT_QUESTION, READY_CONFIG, fakeModelClient, okResult, validPaymentOutput } from "./fixtures";

interface DemoReservation {
  status: "pending" | "succeeded" | "released";
}

class FakeDemoQuotaDatabase implements PostgresQueryable {
  readonly reservations = new Map<string, DemoReservation>();
  successfulResponses = 0;
  fail = false;
  failSettlement = false;
  expireOnSuccessfulSettlement = false;

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    if (this.fail) throw new Error("database unavailable");
    const id = String(values[0]);
    let ok = false;

    if (text.includes("reserve_assistant_demo_response")) {
      const pending = [...this.reservations.values()].filter((item) => item.status === "pending").length;
      if (
        !this.reservations.has(id) &&
        this.successfulResponses + pending < 10
      ) {
        this.reservations.set(id, { status: "pending" });
        ok = true;
      }
    } else if (text.includes("settle_assistant_demo_response")) {
      if (this.failSettlement) throw new Error("database unavailable during settlement");
      const reservation = this.reservations.get(id);
      const success = values[1] === true;
      if (reservation?.status === "succeeded") {
        ok = success;
      } else if (reservation?.status === "released") {
        ok = !success;
      } else if (reservation?.status === "pending") {
        if (success && this.expireOnSuccessfulSettlement) {
          reservation.status = "released";
          ok = false;
        } else if (!success || this.successfulResponses < 10) {
          reservation.status = success ? "succeeded" : "released";
          if (success) this.successfulResponses += 1;
          ok = true;
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

describe("PostgreSQL demo response quota adapter", () => {
  it("admits only ten concurrent reservations", async () => {
    const database = new FakeDemoQuotaDatabase();
    const coordinator = createPostgresAssistantDemoQuotaCoordinator(database);
    const reservations = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      coordinator.reserve({ reservationId: reservationId(index + 1), nowMs: 0 }),
    ));

    expect(reservations.filter(Boolean)).toHaveLength(10);
    expect(database.reservations.size).toBe(10);
  });

  it("rejects duplicate IDs and settles idempotently once", async () => {
    const database = new FakeDemoQuotaDatabase();
    const coordinator = createPostgresAssistantDemoQuotaCoordinator(database);
    const lease = await coordinator.reserve({ reservationId: reservationId(1), nowMs: 0 });

    expect(lease).not.toBeNull();
    expect(await coordinator.reserve({ reservationId: reservationId(1), nowMs: 0 })).toBeNull();
    await lease!.settle(true);
    await lease!.settle(true);
    expect(database.successfulResponses).toBe(1);
    await expect(lease!.settle(false)).rejects.toThrow("already settled differently");
  });

  it("releases failed reservations without consuming a successful slot", async () => {
    const database = new FakeDemoQuotaDatabase();
    const coordinator = createPostgresAssistantDemoQuotaCoordinator(database);
    const lease = await coordinator.reserve({ reservationId: reservationId(2), nowMs: 0 });

    await lease!.settle(false);
    expect(database.successfulResponses).toBe(0);
    expect(database.reservations.get(reservationId(2))?.status).toBe("released");
  });

  it("fails closed on database errors before a production model call", async () => {
    const database = new FakeDemoQuotaDatabase();
    database.fail = true;
    const modelClient = fakeModelClient([okResult(validPaymentOutput())]);
    const result = await runAssistant(
      { question: PAYMENT_QUESTION, selectedCategory: null },
      {
        env: { NODE_ENV: "production", SHARED_RUNTIME_VERIFIED: "true" },
        config: READY_CONFIG,
        modelClient,
        budgetCoordinator: {
          scope: "deployment-shared",
          reserve: () => null,
        },
        demoQuotaCoordinator: createPostgresAssistantDemoQuotaCoordinator(database),
        log: () => {},
      },
    );

    expect(modelClient.calls).toHaveLength(0);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.fallbackReason).toBe("MODEL_UNAVAILABLE");
  });

  it("does not approve a response when shared quota settlement is unavailable", async () => {
    const database = new FakeDemoQuotaDatabase();
    database.failSettlement = true;
    const modelClient = fakeModelClient([okResult(validPaymentOutput())]);
    const result = await runAssistant(
      { question: PAYMENT_QUESTION, selectedCategory: null },
      {
        env: { NODE_ENV: "production", SHARED_RUNTIME_VERIFIED: "true" },
        config: READY_CONFIG,
        modelClient,
        budgetCoordinator: {
          scope: "deployment-shared",
          reserve: () => ({ settle: () => {} }),
        },
        demoQuotaCoordinator: createPostgresAssistantDemoQuotaCoordinator(database),
        log: () => {},
      },
    );

    expect(modelClient.calls).toHaveLength(1);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.fallbackReason).toBe("MODEL_UNAVAILABLE");
    expect(result.directAnswer).not.toBe(validPaymentOutput().directAnswer);
    expect(result.directAnswer).not.toContain(validPaymentOutput().directAnswer);
    expect(database.successfulResponses).toBe(0);
    expect([...database.reservations.values()].map((item) => item.status)).toEqual(["pending"]);
  });

  it("withholds the model answer when the shared quota reservation expires", async () => {
    const database = new FakeDemoQuotaDatabase();
    database.expireOnSuccessfulSettlement = true;
    const modelAnswer = validPaymentOutput().directAnswer;
    const modelClient = fakeModelClient([okResult(validPaymentOutput())]);
    const result = await runAssistant(
      { question: PAYMENT_QUESTION, selectedCategory: null },
      {
        env: { NODE_ENV: "production", SHARED_RUNTIME_VERIFIED: "true" },
        config: READY_CONFIG,
        modelClient,
        budgetCoordinator: {
          scope: "deployment-shared",
          reserve: () => ({ settle: () => {} }),
        },
        demoQuotaCoordinator: createPostgresAssistantDemoQuotaCoordinator(database),
        log: () => {},
      },
    );

    expect(modelClient.calls).toHaveLength(1);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.fallbackReason).toBe("MODEL_UNAVAILABLE");
    expect(result.directAnswer).not.toBe(modelAnswer);
    expect(result.directAnswer).not.toContain(modelAnswer);
    expect(database.successfulResponses).toBe(0);
    expect([...database.reservations.values()].map((item) => item.status)).toEqual(["released"]);
  });
});
