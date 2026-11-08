# syntax=docker/dockerfile:1
ARG GO_VERSION=1.25.0
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS frontend
WORKDIR /src
# @ha/ui is consumed as source through a repo-relative file: link
# (frontend/package.json -> file:../ha-ui); the submodule must be present
# before npm ci resolves the link. It brings its own node_modules (radix
# primitives) — module resolution from ha-ui source files walks upward
# from the submodule, not into /src/frontend/node_modules. react/react-dom
# stay pinned to the frontend copies via vite alias + tsconfig paths.
COPY ha-ui ./ha-ui
RUN cd /src/ha-ui && npm ci --omit=dev
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:${GO_VERSION}-alpine AS builder
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/hasmv .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata gettext \
 && adduser -D -H -u 10001 -h /app app \
 && mkdir -p /app/data /app/frontend/dist \
 && chown -R app:app /app
WORKDIR /app
COPY --from=builder /out/hasmv /app/hasmv
COPY --from=builder /src/frontend/dist/ /app/frontend/dist/
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 18081
USER app
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/app/hasmv"]
