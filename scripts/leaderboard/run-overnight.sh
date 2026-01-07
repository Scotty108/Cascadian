#!/bin/bash
#
# Overnight Superforecaster Scoring Runner
#
# Features:
# - Auto-restarts on crash (max 10 retries)
# - Logs everything to file
# - Sends summary when complete
# - Progress saved to disk (resumable)
#
# Usage:
#   ./scripts/leaderboard/run-overnight.sh
#
# Monitor:
#   tail -f /tmp/superforecaster-overnight.log
#
# Check golden wallets:
#   Run in ClickHouse: SELECT * FROM pm_golden_superforecasters_v1 ORDER BY score DESC

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
LOG_FILE="/tmp/superforecaster-overnight.log"
PROGRESS_FILE="/tmp/superforecaster-scoring-progress.json"
MAX_RETRIES=10
RETRY_DELAY=30

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "SUPERFORECASTER OVERNIGHT RUNNER" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"

retry_count=0

while [ $retry_count -lt $MAX_RETRIES ]; do
    echo "" | tee -a "$LOG_FILE"
    echo "[$(date)] Starting scoring run (attempt $((retry_count + 1))/$MAX_RETRIES)" | tee -a "$LOG_FILE"

    # Run the scoring script
    if npx tsx scripts/leaderboard/score-superforecasters.ts \
        --min-score 1.1 \
        --workers 4 \
        2>&1 | tee -a "$LOG_FILE"; then

        echo "" | tee -a "$LOG_FILE"
        echo "═══════════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
        echo "COMPLETED SUCCESSFULLY" | tee -a "$LOG_FILE"
        echo "Finished: $(date)" | tee -a "$LOG_FILE"
        echo "═══════════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"

        # Print summary
        echo "" | tee -a "$LOG_FILE"
        echo "SUMMARY:" | tee -a "$LOG_FILE"
        if [ -f "$PROGRESS_FILE" ]; then
            cat "$PROGRESS_FILE" | tee -a "$LOG_FILE"
        fi

        exit 0
    else
        exit_code=$?
        retry_count=$((retry_count + 1))

        echo "" | tee -a "$LOG_FILE"
        echo "[$(date)] ERROR: Script exited with code $exit_code" | tee -a "$LOG_FILE"

        if [ $retry_count -lt $MAX_RETRIES ]; then
            echo "[$(date)] Retrying in ${RETRY_DELAY}s... (attempt $((retry_count + 1))/$MAX_RETRIES)" | tee -a "$LOG_FILE"
            sleep $RETRY_DELAY
        fi
    fi
done

echo "" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "FAILED: Max retries ($MAX_RETRIES) exceeded" | tee -a "$LOG_FILE"
echo "Check log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
exit 1
