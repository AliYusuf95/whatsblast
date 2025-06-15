# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# [optional] tests & build
ENV NODE_ENV=production
# RUN bun test
# RUN bun run build
RUN bun run generate-routes

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/src ./src
COPY --from=prerelease /usr/src/app/scripts ./scripts
COPY --from=prerelease /usr/src/app/package.json /usr/src/app/tsconfig.json /usr/src/app/bunfig.toml /usr/src/app/bun-env.d.ts /usr/src/app/drizzle.config.ts /usr/src/app/

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun run /usr/src/app/scripts/healthcheck.ts || exit 1

# Run the application
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT [ "bun", "run", "/usr/src/app/src/serve.ts" ]
