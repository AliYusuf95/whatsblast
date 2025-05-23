# Use the official Bun image
# See all versions at https://hub.docker.com/r/oven/bun/tags
FROM ghcr.io/puppeteer/puppeteer:18.2.1 AS base

WORKDIR /bun

ENV BUN_INSTALL="/usr/local"
ENV PATH="$BUN_INSTALL/bin:$PATH"
ENV NODE_ENV="production"

USER root
RUN curl -fsSL https://bun.sh/install | bash

USER pptruser
WORKDIR /usr/src/app

# Install dependencies into temp directory
# This will cache them and speed up future builds
FROM base AS install

WORKDIR /temp

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# generate routes
COPY bun-env.d.ts tsconfig.json bunfig.toml package.json ./
COPY src src

USER root
RUN chown -R pptruser:pptruser /temp && \
    chmod -R 755 /temp && \
    bun run generate-routes

# Copy production dependencies and source code into final image
FROM base AS release

USER root
COPY --from=install /temp/ ./
RUN chown -R pptruser:pptruser /usr/src/app && \
    chmod -R 755 /usr/src/app

USER pptruser

# Run the application
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT [ "bun", "run", "src/serve.ts" ]
