# Past Failures

## 2026-05-11: Missing Go toolchain in local automation

- The workspace initially lacked a preinstalled Go toolchain, which blocked daemon compile and runtime verification.
- Consequence: early iterations could only verify the JS control plane and web app locally.
- Mitigation: use an explicit local Go `1.22+` toolchain path for daemon tests and end-to-end runs, and keep that requirement documented in `docs/local-dev.md`.
- Current status: local Go verification has now been run with an explicit toolchain, including `go test ./...` and a live daemon-to-server session proof.

## 2026-05-11: Node daemon exited when the control plane disconnected

- The daemon used a single websocket session for `run` and returned the first read or write error back to `main`.
- Consequence: killing or restarting the control plane also killed every connected node daemon, so agents did not recover on their own.
- Mitigation: the daemon now wraps connect, `node.resume`, and capability sync in a reconnect loop with bounded backoff and keeps retrying until the server comes back or the daemon is explicitly stopped.
- Current status: covered by a Go test that simulates a disconnect followed by a successful reconnect and resume.

## 2026-05-11: Agents stayed online after the local agent process died

- The control plane treated capability sync as a static declaration, so an agent stayed `online` as long as the node websocket remained connected.
- Consequence: topology overstated health. A dead or unreachable local agent process still appeared callable until an actual session failed.
- Mitigation: the daemon now probes each configured ACPX agent locally and periodically resyncs only healthy agents, which lets the existing topology model mark failed agents offline.
- Current status: covered by daemon-side Go tests for the health-filter path.
