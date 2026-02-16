#!/bin/bash
# Wrapper around update.sh that records the result to a JSON status file.
# Called by the API in detached mode so it survives service restarts.
#
# Usage: bash update-wrapper.sh <status_file> <issue_id> <overseer_dir>

set -o pipefail

STATUS_FILE="$1"
ISSUE_ID="$2"
OVERSEER_DIR="$3"

if [ -z "$STATUS_FILE" ] || [ -z "$ISSUE_ID" ] || [ -z "$OVERSEER_DIR" ]; then
  echo "Usage: update-wrapper.sh <status_file> <issue_id> <overseer_dir>" >&2
  exit 2
fi

SCRIPT_PATH="${OVERSEER_DIR}/scripts/update.sh"
STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
HEAD_BEFORE=$(cd "$OVERSEER_DIR" && git rev-parse HEAD 2>/dev/null || echo "")

# Write "running" status
mkdir -p "$(dirname "$STATUS_FILE")"
cat > "$STATUS_FILE" <<EOF
{
  "issueId": "${ISSUE_ID}",
  "startedAt": "${STARTED_AT}",
  "finishedAt": "",
  "ok": false,
  "exitCode": null,
  "command": "bash ${SCRIPT_PATH} --yes --stash",
  "headBefore": "${HEAD_BEFORE}",
  "headAfter": null,
  "output": "(update in progress...)",
  "status": "running"
}
EOF

# Run the actual update script and capture output
OUTPUT=$(OVERSEER_DIR="$OVERSEER_DIR" bash "$SCRIPT_PATH" --yes --stash 2>&1) || true
EXIT_CODE=${PIPESTATUS[0]:-$?}

FINISHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
HEAD_AFTER=$(cd "$OVERSEER_DIR" && git rev-parse HEAD 2>/dev/null || echo "")

if [ "$EXIT_CODE" -eq 0 ]; then
  OK="true"
else
  OK="false"
fi

# Escape output for JSON (replace special chars)
ESCAPED_OUTPUT=$(printf '%s' "$OUTPUT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$(printf '%s' "$OUTPUT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g; s/\r/\\r/g; s/\t/\\t/g')")

cat > "$STATUS_FILE" <<EOF
{
  "issueId": "${ISSUE_ID}",
  "startedAt": "${STARTED_AT}",
  "finishedAt": "${FINISHED_AT}",
  "ok": ${OK},
  "exitCode": ${EXIT_CODE},
  "command": "bash ${SCRIPT_PATH} --yes --stash",
  "headBefore": "${HEAD_BEFORE}",
  "headAfter": "${HEAD_AFTER}",
  "output": ${ESCAPED_OUTPUT},
  "status": "completed"
}
EOF
