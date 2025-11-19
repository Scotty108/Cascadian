#!/bin/bash
# WATCHDOG - Auto-restart failed blockchain workers
# Monitors workers every 30 seconds and restarts if crashed
# Also throttles rate limits if repeated failures detected

WATCHDOG_LOG="watchdog.log"
FAILURE_COUNT_FILE="./worker-failure-counts.txt"

# Initialize failure counts
if [ ! -f "$FAILURE_COUNT_FILE" ]; then
  echo "1:0 2:0 3:0 4:0 5:0" > "$FAILURE_COUNT_FILE"
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$WATCHDOG_LOG"
}

get_failure_count() {
  local worker_id=$1
  grep -o "${worker_id}:[0-9]*" "$FAILURE_COUNT_FILE" | cut -d: -f2
}

increment_failure() {
  local worker_id=$1
  local count=$(get_failure_count $worker_id)
  local new_count=$((count + 1))
  sed -i.bak "s/${worker_id}:${count}/${worker_id}:${new_count}/" "$FAILURE_COUNT_FILE"
  echo $new_count
}

reset_failure() {
  local worker_id=$1
  sed -i.bak "s/${worker_id}:[0-9]*/${worker_id}:0/" "$FAILURE_COUNT_FILE"
}

restart_worker() {
  local worker_id=$1
  local from_block=$2
  local to_block=$3
  local blocks_per_batch=$4
  local rate_limit=$5

  log "🔄 Restarting Worker $worker_id (blocks $from_block-$to_block)"

  WORKER_ID=$worker_id \
  FROM_BLOCK=$from_block \
  TO_BLOCK=$to_block \
  BLOCKS_PER_BATCH=$blocks_per_batch \
  RATE_LIMIT_MS=$rate_limit \
  npx tsx blockchain-resolution-backfill.ts > "blockchain-worker-${worker_id}.log" 2>&1 &

  log "✓ Worker $worker_id restarted (PID $!)"
}

check_worker() {
  local worker_id=$1
  local from_block=$2
  local to_block=$3
  local blocks_per_batch=$4
  local base_rate_limit=$5

  # Check if worker process is running
  if ! pgrep -f "WORKER_ID=$worker_id" > /dev/null; then

    # Check if it finished successfully or crashed
    if tail -5 "blockchain-worker-${worker_id}.log" 2>/dev/null | grep -q "BACKFILL COMPLETE"; then
      log "✅ Worker $worker_id completed successfully"
      reset_failure $worker_id
      return 0
    fi

    # Worker crashed - check for rate limit errors
    local failure_count=$(increment_failure $worker_id)
    log "⚠️  Worker $worker_id crashed (failure #$failure_count)"

    # Throttle more aggressively after repeated failures
    local rate_limit=$base_rate_limit
    if [ $failure_count -ge 3 ]; then
      rate_limit=$((base_rate_limit * 2))
      log "   Throttling Worker $worker_id to ${rate_limit}ms (repeated failures)"
    fi

    if [ $failure_count -le 10 ]; then
      restart_worker $worker_id $from_block $to_block $blocks_per_batch $rate_limit
    else
      log "❌ Worker $worker_id failed too many times ($failure_count), giving up"
      return 1
    fi
  else
    # Worker is running - reset failure count
    reset_failure $worker_id
  fi
}

log "═══════════════════════════════════════════════════════════════"
log "WATCHDOG STARTED - Monitoring 5 blockchain workers"
log "═══════════════════════════════════════════════════════════════"

while true; do
  log "Checking worker status..."

  # Worker configs (block ranges and rate limits)
  check_worker 1 10000000 30000000 30000 40
  check_worker 2 30000000 42000000 20000 40
  check_worker 3 42000000 54000000 20000 40
  check_worker 4 54000000 66000000 20000 40
  check_worker 5 66000000 78700000 20000 40

  # Check API backfill too
  if ! pgrep -f "backfill-polymarket-api.ts" > /dev/null; then
    if tail -5 polymarket-api-backfill.log 2>/dev/null | grep -q "BACKFILL COMPLETE"; then
      log "✅ API Backfill completed successfully"
    else
      log "🔄 Restarting API backfill"
      npx tsx backfill-polymarket-api.ts > polymarket-api-backfill.log 2>&1 &
    fi
  fi

  # Sleep 30 seconds before next check
  sleep 30
done
