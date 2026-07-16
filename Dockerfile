FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

RUN npm run build

FROM node:22-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3004

CMD ["node", "dist/main.js"]
