import { describe, expect, it } from "vitest";
import { demoPolicy } from "@/lib/domain/policy";
import {
  ACTION_SESSION_COOKIE_NAME,
  ACTION_SESSION_COOKIE_PATH,
  MAX_ACTION_SESSION_COOKIE_BYTES,
  actionSessionSetCookie,
  createActionDemoSession,
  isSigningSecretReady,
  readSignedActionSession,
  signActionDemoSession,
} from "@/lib/assistant/action-session";

const SECRET = "unit-test-only-action-session-secret-32-bytes";
const NOW = Date.parse(demoPolicy.demoNow);

describe("signed fictional action sessions", () => {
  it("signs and validates a bounded server-owned fixture session", () => {
    const session = createActionDemoSession("BASE", NOW);
    const token = signActionDemoSession(session, SECRET);

    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(
      MAX_ACTION_SESSION_COOKIE_BYTES,
    );
    expect(readSignedActionSession(
      `${ACTION_SESSION_COOKIE_NAME}=${token}`,
      SECRET,
      NOW,
    )).toMatchObject({ status: "VALID", session: { scenario: "BASE", stateVersion: 0 } });
  });

  it("rejects a tampered token, oversized cookie, and missing or short secret", () => {
    const token = signActionDemoSession(createActionDemoSession("BASE", NOW), SECRET);
    const [version, payload, signature] = token.split(".");
    const changedSignature = signature!.startsWith("A")
      ? `B${signature!.slice(1)}`
      : `A${signature!.slice(1)}`;
    const tampered = `${version}.${payload}.${changedSignature}`;
    const modifiedPayload = `${version}.${payload!.slice(0, 1) === "A" ? "B" : "A"}${payload!.slice(1)}.${signature}`;

    expect(readSignedActionSession(`${ACTION_SESSION_COOKIE_NAME}=${tampered}`, SECRET, NOW).status).toBe("INVALID");
    expect(readSignedActionSession(`${ACTION_SESSION_COOKIE_NAME}=${modifiedPayload}`, SECRET, NOW).status).toBe("INVALID");
    expect(readSignedActionSession(`${ACTION_SESSION_COOKIE_NAME}=not-a-versioned-token`, SECRET, NOW).status).toBe("INVALID");
    expect(readSignedActionSession("x".repeat(9_000), SECRET, NOW).status).toBe("INVALID");
    expect(readSignedActionSession(`${ACTION_SESSION_COOKIE_NAME}=${token}`, undefined, NOW).status).toBe("INVALID");
    expect(isSigningSecretReady("too-short")).toBe(false);
    expect(isSigningSecretReady(SECRET)).toBe(true);
  });

  it("rejects an expired demo session", () => {
    const session = createActionDemoSession("BASE", NOW);
    const token = signActionDemoSession(session, SECRET);

    expect(readSignedActionSession(
      `${ACTION_SESSION_COOKIE_NAME}=${token}`,
      SECRET,
      Date.parse(session.expiresAt),
    ).status).toBe("EXPIRED");
  });

  it("sets HttpOnly, SameSite=Strict, path scope, and production Secure", () => {
    const session = createActionDemoSession("BASE", NOW);
    const cookie = actionSessionSetCookie("opaque", session, { NODE_ENV: "production" }, NOW);

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain(`Path=${ACTION_SESSION_COOKIE_PATH}`);
    expect(cookie).toContain("Secure");
  });

  it("contains only the fictional server-owned fixture and no credential fields", () => {
    const session = createActionDemoSession("BASE", NOW);
    const token = signActionDemoSession(session, SECRET);
    const read = readSignedActionSession(
      `${ACTION_SESSION_COOKIE_NAME}=${token}`,
      SECRET,
      NOW,
    );

    expect(read.status).toBe("VALID");
    if (read.status === "VALID") {
      expect(read.session.state).toMatchObject({
        investor: { id: "demo_investor_001", displayName: "Demo Investor 001" },
        sip: { id: "sip_demo_001", monthlyAmount: 5000 },
      });
      expect(JSON.stringify(read.session)).not.toMatch(/password|otp|pin|cvv|pan|bankAccount/i);
    }
  });
});
