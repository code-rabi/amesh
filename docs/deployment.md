# Deployment Shape

## Decision

The MVP ships as one control-plane deployable and one separate remote daemon install.

## Why

- The dashboard does not justify a second deployment artifact for MVP.
- Serving the built SPA from the Fastify control plane keeps local development, Docker packaging, and first deployment simpler.
- The remote daemon still needs to live outside the control plane because it runs next to local ACPX-backed agent binaries on target machines.

## Result

- The root `Dockerfile` builds the web app and runs only the server process.
- The server serves `apps/web/dist` directly in deployed environments.
- Production deployments should set `AMESH_REGISTRATION_TOKEN` so node bootstrap is explicitly gated.
- Remote machines install `amesh-node` separately through the root `install-amesh-node.sh` release installer.
