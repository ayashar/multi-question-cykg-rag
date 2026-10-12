#!/bin/bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 PREDICTION.json OUTPUT.json [--allow-draft]"
  exit 2
fi

cd "$(dirname "$0")"
prediction="$1"
output="$2"
shift 2

.venv/bin/python -m eval.score_attack_graph \
  --reference eval/ground_truth/russellmitchell.reference.json \
  --event-ground-truth eval/ground_truth/russellmitchell_event_v5/alert_event_ground_truth.jsonl \
  --prediction "$prediction" \
  --output "$output" \
  "$@"
