#!/bin/bash
# Safe default: offline validation. Explicit --execute enables paid calls.
#
# Interpreter: $EVAL_PYTHON if set; otherwise the first of
# $UV_PROJECT_ENVIRONMENT, ~/.venvs/multi-agents-cykg, then the in-tree .venv.
# The in-tree .venv is last on purpose: this project lives in a cloud-synced
# folder, and an environment there can be offloaded and hang on import.
set -euo pipefail
cd "$(dirname "$0")"
source scripts/project_python.sh
exec "$PY" -u -m eval.run_case_alert_eval "$@"
