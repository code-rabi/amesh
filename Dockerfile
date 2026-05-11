FROM node:22-slim

WORKDIR /app

RUN corepack enable && corepack install -g pnpm@11.0.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @amesh/web build

ENV HOST=0.0.0.0
ENV PORT=3001
ENV AMESH_WEB_DIST=/app/apps/web/dist
ENV AMESH_REGISTRATION_TOKEN=demo-token

EXPOSE 3001

CMD ["pnpm", "--filter", "@amesh/server", "start"]
