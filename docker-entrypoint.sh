#!/bin/sh
set -e

# Render the YAML config from a template so deployment-scoped values
# (upstream URLs and other deployment-scoped values) can be injected through
# the environment. This service has no database of its own; all data operations
# tunnel through the upstream MCA maintenance endpoint.
if [ -n "${CONFIG_TEMPLATE:-}" ] && [ -n "${RENDERED_CONFIG:-}" ] && [ -f "${CONFIG_TEMPLATE}" ]; then
  envsubst < "${CONFIG_TEMPLATE}" > "${RENDERED_CONFIG}"
fi

exec "$@"
