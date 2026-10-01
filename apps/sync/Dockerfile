FROM node:26-alpine
WORKDIR /app
RUN npm install -g pnpm@12.8.1

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/sync ./apps/sync
RUN pnpm install --frozen-lockfile --filter @opencall/sync...

ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@opencall/sync", "start"]
