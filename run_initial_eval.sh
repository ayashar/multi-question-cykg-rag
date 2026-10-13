#!/bin/bash
# Explicit --prepare, --execute or --report; no paid work by default.
set -euo pipefail
cd "$(dirname "$0")"
source scripts/project_python.sh
exec "$PY" -u -m eval.initial_study "$@"
