#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run generate
if [ "${REPLIT_DEPLOYMENT:-0}" != "1" ] && [ "${NODE_ENV:-development}" != "production" ]; then
  NODE_ENV=development pnpm --filter @workspace/db run migrate:dev
  NODE_ENV=development pnpm --filter @workspace/api-server run jobs:install:dev
fi
