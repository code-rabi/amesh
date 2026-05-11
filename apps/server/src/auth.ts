import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "amesh_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type AuthConfig = {
  username: "admin";
  password: string;
  secret: string;
  cookieName: string;
  sessionTtlMs: number;
};

export type SessionPayload = {
  username: string;
  issuedAt: number;
};

type AuthOverrides = {
  password?: string;
  secret?: string;
};

function maskBanner(label: string, value: string): string {
  const banner = "=".repeat(60);
  return `\n${banner}\n${label}: ${value}\n${banner}\n`;
}

/**
 * Resolve auth credentials from the environment. The admin password is read
 * from AUTH_ADMIN_PASSWORD first, then the legacy AMESH_PASSWORD. If neither is
 * set, a random UUID is generated for this process and logged once so the
 * operator can retrieve it from the server log. The session secret follows the
 * same AUTH_/AMESH_ fallback order and is generated per-process when unset.
 */
export function resolveAuthConfig(overrides: AuthOverrides = {}): AuthConfig {
  const username = "admin" as const;
  let password = (overrides.password ?? process.env.AUTH_ADMIN_PASSWORD ?? process.env.AMESH_PASSWORD ?? "").trim();
  let passwordGenerated = false;
  if (!password) {
    password = randomUUID();
    passwordGenerated = true;
  }

  let secret = (overrides.secret ?? process.env.AUTH_SESSION_SECRET ?? process.env.AMESH_SESSION_SECRET ?? "").trim();
  let secretGenerated = false;
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    secretGenerated = true;
  }

  if (passwordGenerated) {
    console.warn(
      maskBanner(
        "AMESH admin password generated for this process. Set AUTH_ADMIN_PASSWORD to keep it stable",
        password
      )
    );
  }
  if (secretGenerated) {
    console.warn(
      "[amesh] AMESH_SESSION_SECRET is not set. A random secret was generated for this process; restart will invalidate all sessions. Set AMESH_SESSION_SECRET to a persistent value in production."
    );
  }

  return {
    username,
    password,
    secret,
    cookieName: COOKIE_NAME,
    sessionTtlMs: SESSION_TTL_MS
  };
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function issueSession(config: AuthConfig, username: string): string {
  const payload: SessionPayload = {
    username,
    issuedAt: Date.now()
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(body, config.secret);
  return `${body}.${signature}`;
}

export function verifySession(config: AuthConfig, raw: string | undefined): SessionPayload | null {
  if (!raw) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  const expected = sign(body, config.secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.username !== "string" || typeof payload.issuedAt !== "number") {
      return null;
    }
    if (Date.now() - payload.issuedAt > config.sessionTtlMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Read the session cookie from a raw `Cookie:` header. Used for WS upgrades
 * where Fastify's parsed cookies aren't available.
 */
export function readSessionCookieFromHeader(header: string | undefined, cookieName: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq);
    if (name !== cookieName) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}
