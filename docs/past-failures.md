# Past Failures

## 2026-05-13: OpenClaw could get stuck on stale ACPX session metadata

- Symptom: production OpenClaw sessions failed with `ACP_SESSION_INIT_FAILED` and `ACP metadata is missing for agent:main:acp:<id>`, instructing the operator to recreate the ACP session with `/acp spawn`.
- Cause: the node daemon reused the server session id as the ACPX session name, but a stale ACPX session could exist without the backing ACP metadata OpenClaw needs to initialize.
- Mitigation: the Go ACPX runner now treats that exact metadata-missing failure as recoverable both during `sessions ensure` and during the first prompt run, recreates the named ACPX session once with `sessions new --name <session>`, and retries. Regression tests cover the ensure path and the OpenClaw prompt-time failure shape.

## 2026-05-13: OpenClaw executable detection could accept a broken wrapper

- Symptom: `openclaw` was present on `PATH`, but `acpx openclaw` failed before ACP `initialize` because the first executable was a wrapper that depended on unavailable local state.
- Cause: detection treated executable presence as enough, while OpenClaw's ACPX target needs `openclaw acp` to run as a clean stdio ACP server from the daemon environment.
- Mitigation: OpenClaw detection now probes every `openclaw` executable directory on `PATH` with ACPX `sessions ensure`, persists the first PATH ordering that initializes successfully, and omits OpenClaw if none can start ACP. A regression test covers a broken wrapper before a working executable.

## 2026-05-13: Installer service PATH could be truncated by spaces

- Symptom: a node installed successfully, but the user service could later run with a truncated `PATH` when the shell PATH contained entries with spaces such as WSL-mounted `Program Files` directories.
- Cause: the installer wrote raw `Environment=PATH=...` lines into the systemd unit. systemd splits unquoted environment assignments on whitespace.
- Mitigation: the installer now quotes and escapes systemd `Environment` values, and the stdin installer test covers a PATH entry containing spaces.

## 2026-05-13: Main artifact build failed in ACPX stream test

- Symptom: the `Build linux-amd64` artifact job on `main` failed in `TestRunnerStreamsStdoutLineByLine` with empty stdout from the helper process.
- Cause: that test depended on re-running the Go test binary as a helper process for a simple stdout/stderr stream case, which made the artifact workflow sensitive to test-binary invocation behavior.
- Mitigation: the stream test now uses a tiny explicit executable fixture for the stdout/stderr path and keeps the Go helper process only for ACPX command-shape tests.

## 2026-05-12: Installer rejected valid Node 24 runtimes

- Symptom: remote bootstrap failed early with `could not determine Node.js major version` even though `node -v` reported `v24.13.1`.
- Cause: the installer used `node -p` with `process.stdout.write(...)`, and newer Node releases printed both the written major and the boolean return value, producing values like `24true`.
- Mitigation: the installer now parses the major through a pure `node -p` expression and CI runs `scripts/test-install-amesh-node.sh` to cover both the Node 24 happy path and the invalid-parse failure path.

## 2026-05-13: Installer crashed when piped into `bash`

- Symptom: `curl .../install-amesh-node.sh | ... bash` failed at the end with `BASH_SOURCE[0]: unbound variable`.
- Cause: the script ran under `set -u` and assumed `BASH_SOURCE[0]` exists, which is false when Bash reads the script from stdin instead of a file path.
- Mitigation: the entrypoint guard now falls back to `$0` when `BASH_SOURCE` is unset, and `scripts/test-install-amesh-node.sh` now executes the installer through stdin to cover the real bootstrap shape.

## 2026-05-13: Docker deployments could mount the documented SQLite folder and still lose data

- Symptom: operators mounted `/app/apps/server/data` in the control-plane container, but SQLite state still disappeared on redeploy.
- Cause: the server defaulted to a relative DB path and `pnpm --filter @amesh/server start` ran with cwd `/app/apps/server`, so the actual live DB landed under `/app/apps/server/apps/server/data/amesh.sqlite`.
- Mitigation: the server now resolves its default SQLite path from the server package location instead of `process.cwd()`, and a Vitest case covers that default path against a changed cwd.

## 2026-05-11: Server smoke drifted from browser auth

- The smoke script still called browser-facing session and trigger APIs anonymously after the server moved those routes behind cookie auth.
- Consequence: `pnpm --filter @amesh/server smoke` crashed before it could validate the MVP path, even though the rest of the JS test suite stayed green.
- Mitigation: the smoke flow now logs in first, and the root `corepack pnpm check` gate includes smoke so GitHub Actions catches the same regression path.

## Local daemon failed on stale ACPX user config

- Date: 2026-05-12
- Symptom: `pnpm dev:daemon` detected agents but their health probes failed immediately with `Invalid config nonInteractivePermissions in ~/.acpx/config.json: expected deny or fail`.
- Cause: our bootstrap installed ACPX but did not validate or create the ACPX user config, so stale local values like `approve-all` in `nonInteractivePermissions` broke first-run non-interactive probes.
- Mitigation: both `scripts/dev-daemon.sh` and `install-amesh-node.sh` normalize `~/.acpx/config.json` before detect/register, and the Go ACPX runner repeats that guard before health probes and session starts. Missing or invalid `nonInteractivePermissions` is forced to `deny`.

## 2026-05-11: Quality checks covered behavior better than structural drift

- The repo had behavior checks, but nothing blocked merges for unused TypeScript surface area or repo-level architecture rule regressions.
- Consequence: dead dependencies, stale exports, and structural erosion could accumulate without showing up as independent PR checks.
- Mitigation: `knip` now runs as a dedicated unused-code gate, and `sentrux` runs as a separate architecture check backed by `.sentrux/rules.toml`.

## 2026-05-11: Demo agent bootstrap masked real node inventory

- The daemon and installer defaulted to a demo config with `claude`, `codex`, and `openclaw`, even on machines where those local ACPX targets were not actually available.
- Consequence: fresh nodes looked broken or permanently offline because the first advertised inventory was a placeholder and health probing immediately knocked those fake agents out.
- Mitigation: the daemon now has a first-class `detect` command, uses detection as the default config bootstrap path, and the dashboard can trigger detection on an online node to refresh inventory in place.
- Follow-up: detection now prefers the managed ACPX sidecar path automatically and records installed local agent CLIs before health filtering, so slow ACPX providers do not disappear from config generation.

## 2026-05-12: Local dev daemon could stay pinned to example config through saved state

- `pnpm dev:daemon` correctly defaulted to `.amesh-agents.json`, but an existing `.amesh-node-state.json` could still point at `examples/agents.json` and silently override that default on later runs.
- Consequence: local development could keep mutating or reading the example config, and the dashboard would show stale demo inventory instead of the real detected local agents.
- Mitigation: `scripts/dev-daemon.sh` now refuses `examples/agents.json` as the local dev config target and deletes stale local daemon state that still references the example config before re-detecting into `.amesh-agents.json`.

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

## 2026-05-11: Remote install could look successful while the long-lived node never actually stayed up

- The installer reported a completed install after writing the binary and service file, but it did not verify that the user service remained active or show enough detail about detect/register/state reuse.
- Consequence: a host could look "installed" locally while the dashboard stayed empty and there was no immediate clue whether detection, registration, or service startup had failed.
- Mitigation: the installer now logs each detect/register decision, fails fast if the systemd user service does not stay active, and prints service status plus recent journal lines. The daemon also logs detect, register, resume, and capability-sync milestones to stderr.

## 2026-05-12: Registered nodes could advertise agent CLIs that only worked in the installer shell

- Detection ran in an interactive shell, but later session launches and health probes ran from the long-lived daemon environment. On hosts that used `nvm` or another shell-managed Node install, the service could resolve a different `node` binary than the one that made `copilot`, `cursor`, or `opencode` work during registration.
- Consequence: a fresh node could advertise agents, yet the dashboard showed runtime errors like `/usr/bin/env: 'node': No such file or directory` or `toSorted is not a function` once the daemon tried to execute them.
- Mitigation: detected agent configs now persist the working shell `PATH`, and the installer now fails fast unless `node` `22.x+` is available before it installs the daemon service. Covered by a Go detection test that asserts the saved agent env includes the original `PATH`.

## 2026-05-11: Node inventory had no lightweight way to express multiple working directories

- The node config only described base agents, so a single machine could not advertise the same local agent across multiple useful workspaces without hand-editing duplicate agent entries.
- Consequence: CWD management was brittle and there was no simple admin flow to expose extra repositories on a node before a fuller project model existed.
- Follow-up: the first implementation expanded those folders into fake per-folder agents, which blurred the model and polluted topology.
- Current mitigation: node config still has a top-level `paths` list, but those paths are now exposed session folders on the node. Agents stay as base inventory, and sessions carry `cwd` explicitly.
