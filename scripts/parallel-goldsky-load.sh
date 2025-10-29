#!/bin/bash
# Parallel Goldsky Load - 10 workers with auto-backoff and checkpointing

WALLETS_FILE="runtime/placeholder_wallets_to_reload.txt"
TOTAL_WALLETS=$(wc -l < "$WALLETS_FILE")
NUM_WORKERS=10
WALLETS_PER_WORKER=$((TOTAL_WALLETS / NUM_WORKERS + 1))

echo "═══════════════════════════════════════════════════════════"
echo "  PARALLEL GOLDSKY LOAD - 10 WORKERS (Auto-Backoff Enabled)"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Total wallets: $TOTAL_WALLETS"
echo "Workers: $NUM_WORKERS"
echo "Wallets per worker: ~$WALLETS_PER_WORKER"
echo ""

# Split wallet file into chunks
mkdir -p runtime/parallel-loads
split -l $WALLETS_PER_WORKER "$WALLETS_FILE" runtime/parallel-loads/chunk_

# Start workers
WORKER_NUM=0
for chunk in runtime/parallel-loads/chunk_*; do
  WORKER_NUM=$((WORKER_NUM + 1))
  LOG_FILE="runtime/parallel-loads/worker_${WORKER_NUM}.log"
  CHECKPOINT_FILE="runtime/parallel-loads/worker_${WORKER_NUM}.checkpoint.json"

  echo "🚀 Starting Worker $WORKER_NUM ($(wc -l < $chunk) wallets)..."

  npx tsx scripts/goldsky-load-recent-trades.ts \
    --wallets-file="$chunk" \
    --checkpoint="$CHECKPOINT_FILE" \
    > "$LOG_FILE" 2>&1 &

  echo "   PID: $!"
  echo "   Log: $LOG_FILE"
  echo ""

  # Small delay to avoid hammering API at exact same time
  sleep 2
done

echo "═══════════════════════════════════════════════════════════"
echo "✅ All $NUM_WORKERS workers started!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Monitor progress:"
echo "  tail -f runtime/parallel-loads/worker_*.log"
echo ""
echo "Check processes:"
echo "  ps aux | grep goldsky-load-recent-trades"
echo ""
