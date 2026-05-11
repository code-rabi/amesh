import { FormEvent, useEffect, useState } from "react";
import { RouterProvider } from "@tanstack/react-router";

import { ApiUnauthorizedError, fetchAuthSession, login, onUnauthorized } from "./api.js";
import { BrandWordmark } from "./components/BrandWordmark.js";
import { SessionsProvider } from "./lib/sessionsContext.js";
import { TopologyProvider } from "./lib/topologyContext.js";
import { router } from "./router.js";
import "./styles.css";

export function App() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "anonymous">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAuthSession()
      .then((session) => {
        if (!active) return;
        setAuthState(session.authenticated ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (!active) return;
        setAuthState("anonymous");
      });

    return onUnauthorized(() => {
      if (!active) return;
      setPassword("");
      setError(null);
      setAuthState("anonymous");
    });
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(password);
      setPassword("");
      setAuthState("authenticated");
    } catch (cause) {
      setError(cause instanceof ApiUnauthorizedError ? "Incorrect password." : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authState !== "authenticated") {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <p className="auth-kicker">Control Plane</p>
          <h1>
            <BrandWordmark className="auth-wordmark" />
          </h1>
          <p className="auth-copy">Enter the admin password to open the dashboard.</p>
          <form className="auth-form" onSubmit={(event) => void handleLogin(event)}>
            <label className="auth-label" htmlFor="admin-password">
              Admin password
            </label>
            <input
              id="admin-password"
              className="auth-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting || authState === "loading"}
            />
            {error ? <p className="auth-error">{error}</p> : null}
            <button className="btn btn-primary auth-submit" type="submit" disabled={submitting || authState === "loading"}>
              {authState === "loading" ? "Checking session" : submitting ? "Signing in" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <TopologyProvider>
      <SessionsProvider>
        <RouterProvider router={router} />
      </SessionsProvider>
    </TopologyProvider>
  );
}
