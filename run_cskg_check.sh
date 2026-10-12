#!/bin/bash
# Independent health check of the CSKG (MITRE ATT&CK) MCP server.
# Free: no LLM calls, no database access. Exit status 0 = healthy.
#
#   bash run_cskg_check.sh            readable report
#   bash run_cskg_check.sh --json     full report as JSON
#
# Uses the same interpreter resolution as run_full_alert_eval.sh, so it
# checks the server exactly as the evaluation would launch it.
set -euo pipefail
cd "$(dirname "$0")"
source scripts/project_python.sh
exec "$PY" -m src.agents.cskg_health "$@"
