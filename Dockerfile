FROM oven/bun:1.4.2 AS lustpress-build
WORKDIR /srv/lustpress
COPY vendor/lustpress/package.json vendor/lustpress/bun.lock ./
RUN bun install --frozen-lockfile
COPY vendor/lustpress/ ./
RUN bun run build

FROM oven/bun:1.4.2 AS lustpress-deps
WORKDIR /srv/lustpress
COPY vendor/lustpress/package.json vendor/lustpress/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:22-bookworm-slim
WORKDIR /srv/liszt
COPY --from=lustpress-build /usr/local/bin/bun /usr/local/bin/bun
COPY --from=lustpress-build /srv/lustpress/build /srv/lustpress/build
COPY --from=lustpress-deps /srv/lustpress/node_modules /srv/lustpress/node_modules
COPY vendor/lustpress/package.json /srv/lustpress/package.json
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY data/catalogue.json ./data/catalogue.json
COPY scripts/start-render.sh ./scripts/start-render.sh
RUN chmod +x ./scripts/start-render.sh
ENV LUSTPRESS_URL=http://127.0.0.1:3001
CMD ["./scripts/start-render.sh"]
