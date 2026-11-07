import type {
  ActionSessionExpectation,
  SharedActionSessionStore,
} from "@/lib/assistant/action-session-store";
import type { ActionDemoSession } from "@/lib/assistant/action-session";

interface StoredSession {
  session: ActionDemoSession;
  cookieHash: string;
  revoked: boolean;
}

interface StoredPreview {
  sessionId: string;
  stateVersion: number;
  expiresAt: string;
  consumed: boolean;
  revoked: boolean;
}

/** Atomic in-memory test double; production adapters use PostgreSQL functions. */
export class InMemorySharedActionSessionStore implements SharedActionSessionStore {
  readonly scope = "deployment-shared" as const;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly previews = new Map<string, StoredPreview>();
  private failure: Error | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  failNextOperation(message = "database unavailable"): void {
    this.failure = new Error(message);
  }

  private checkFailure(): void {
    if (!this.failure) return;
    const failure = this.failure;
    this.failure = null;
    throw failure;
  }

  private hash(value: Uint8Array): string {
    return Buffer.from(value).toString("hex");
  }

  private matches(expected: ActionSessionExpectation, allowExpired = false): StoredSession | null {
    const stored = this.sessions.get(expected.sessionId);
    if (
      !stored || stored.revoked ||
      stored.cookieHash !== this.hash(expected.cookieHash) ||
      stored.session.stateVersion !== expected.stateVersion ||
      (!allowExpired && Date.parse(stored.session.expiresAt) <= this.now())
    ) return null;
    return stored;
  }

  private syncPreview(session: ActionDemoSession): void {
    for (const preview of this.previews.values()) {
      if (preview.sessionId === session.sessionId && !preview.consumed && !preview.revoked) {
        preview.revoked = true;
      }
    }
    const pending = session.pendingPreview;
    if (pending) {
      this.previews.set(pending.previewId, {
        sessionId: session.sessionId,
        stateVersion: pending.stateVersion,
        expiresAt: pending.expiresAt,
        consumed: false,
        revoked: false,
      });
    }
  }

  private insert(session: ActionDemoSession, cookieHash: Uint8Array): boolean {
    if (this.sessions.has(session.sessionId)) return false;
    this.sessions.set(session.sessionId, {
      session: structuredClone(session),
      cookieHash: this.hash(cookieHash),
      revoked: false,
    });
    this.syncPreview(session);
    return true;
  }

  async load(expected: ActionSessionExpectation): Promise<ActionDemoSession | null> {
    this.checkFailure();
    const stored = this.matches(expected);
    return stored ? structuredClone(stored.session) : null;
  }

  async create(session: ActionDemoSession, cookieHash: Uint8Array): Promise<boolean> {
    this.checkFailure();
    return this.insert(session, cookieHash);
  }

  async replace(
    expected: ActionSessionExpectation,
    nextSession: ActionDemoSession,
    nextCookieHash: Uint8Array,
  ): Promise<boolean> {
    this.checkFailure();
    const current = this.matches(expected);
    if (!current) return false;
    if (nextSession.sessionId === expected.sessionId) {
      if (nextSession.scenario !== current.session.scenario) return false;
      current.session = structuredClone(nextSession);
      current.cookieHash = this.hash(nextCookieHash);
      this.syncPreview(nextSession);
      return true;
    }
    current.revoked = true;
    for (const preview of this.previews.values()) {
      if (preview.sessionId === expected.sessionId && !preview.consumed) preview.revoked = true;
    }
    if (!this.insert(nextSession, nextCookieHash)) {
      throw new Error("replacement session id collision");
    }
    return true;
  }

  async confirm(
    expected: ActionSessionExpectation,
    previewId: string,
    allowAction: boolean,
    nextSession: ActionDemoSession,
    nextCookieHash: Uint8Array,
  ): Promise<boolean> {
    this.checkFailure();
    const current = this.matches(expected);
    const preview = this.previews.get(previewId);
    if (
      !current || !preview || preview.sessionId !== expected.sessionId ||
      preview.stateVersion !== expected.stateVersion || preview.consumed || preview.revoked ||
      current.session.pendingPreview?.previewId !== previewId ||
      (allowAction && Date.parse(preview.expiresAt) <= this.now())
    ) return false;
    preview.consumed = true;
    current.session = structuredClone(nextSession);
    current.cookieHash = this.hash(nextCookieHash);
    this.syncPreview(nextSession);
    return true;
  }

  async reset(
    expected: ActionSessionExpectation | null,
    nextSession: ActionDemoSession,
    nextCookieHash: Uint8Array,
  ): Promise<boolean> {
    this.checkFailure();
    if (expected) {
      const current = this.matches(expected, true);
      if (!current) return false;
      current.revoked = true;
      for (const preview of this.previews.values()) {
        if (preview.sessionId === expected.sessionId && !preview.consumed) preview.revoked = true;
      }
    }
    if (!this.insert(nextSession, nextCookieHash)) {
      throw new Error("reset session id collision");
    }
    return true;
  }
}
