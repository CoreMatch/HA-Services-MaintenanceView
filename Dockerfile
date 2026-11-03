# syntax=docker/dockerfile:1
ARG GO_VERSION=1.25.0
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS frontend
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
