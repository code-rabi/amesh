# Past Failures

## 2026-05-11: Missing Go toolchain in local automation

- The workspace initially lacked a preinstalled Go toolchain, which blocked daemon compile and runtime verification.
- Consequence: early iterations could only verify the JS control plane and web app locally.
- Mitigation: use an explicit local Go `1.22+` toolchain path for daemon tests and end-to-end runs, and keep that requirement documented in `docs/local-dev.md`.
- Current status: local Go verification has now been run with an explicit toolchain, including `go test ./...` and a live daemon-to-server session proof.
