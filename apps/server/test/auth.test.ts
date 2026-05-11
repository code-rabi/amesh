import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAuthConfig } from "../src/auth.js";

const originalEnv = {
  AUTH_ADMIN_PASSWORD: process.env.AUTH_ADMIN_PASSWORD,
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
  AMESH_PASSWORD: process.env.AMESH_PASSWORD,
  AMESH_SESSION_SECRET: process.env.AMESH_SESSION_SECRET
};

afterEach(() => {
  process.env.AUTH_ADMIN_PASSWORD = originalEnv.AUTH_ADMIN_PASSWORD;
  process.env.AUTH_SESSION_SECRET = originalEnv.AUTH_SESSION_SECRET;
  process.env.AMESH_PASSWORD = originalEnv.AMESH_PASSWORD;
  process.env.AMESH_SESSION_SECRET = originalEnv.AMESH_SESSION_SECRET;
  vi.restoreAllMocks();
});

describe("resolveAuthConfig", () => {
  it("logs a generated UUID admin password when no auth env is configured", () => {
    delete process.env.AUTH_ADMIN_PASSWORD;
    delete process.env.AUTH_SESSION_SECRET;
    delete process.env.AMESH_PASSWORD;
    delete process.env.AMESH_SESSION_SECRET;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const config = resolveAuthConfig();

    expect(config.username).toBe("admin");
    expect(config.password).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(config.password));
  });

  it("prefers AUTH_ADMIN_PASSWORD over the legacy AMESH_PASSWORD", () => {
    process.env.AUTH_ADMIN_PASSWORD = "new-secret";
    process.env.AMESH_PASSWORD = "legacy-secret";
    process.env.AUTH_SESSION_SECRET = "stable-secret";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const config = resolveAuthConfig();

    expect(config.password).toBe("new-secret");
    expect(config.secret).toBe("stable-secret");
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("new-secret"));
  });
});
