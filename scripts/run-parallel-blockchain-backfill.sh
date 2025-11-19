#!/bin/bash
# PARALLEL BLOCKCHAIN RESOLUTION BACKFILL
# Launches 5 workers to scan different block ranges simultaneously
# Expected completion: 6-8 hours (instead of 22 hours single-threaded)

echo "═══════════════════════════════════════════════════════════════"
echo "PARALLEL BLOCKCHAIN BACKFILL - 5 WORKERS"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Strategy:"
echo "  Worker 1: Blocks 10M → 30M (sparse era, fast scan)"
echo "  Worker 2: Blocks 30M → 42M (high density)"
echo "  Worker 3: Blocks 42M → 54M (high density)"
echo "  Worker 4: Blocks 54M → 66M (high density)"
echo "  Worker 5: Blocks 66M → 78M (high density)"
echo ""
echo "Expected runtime: 6-8 hours"
echo "RPC: Alchemy Polygon (25 req/sec per worker)"
echo ""
echo "Starting workers..."
echo ""

# Kill old blockchain backfill if running
pkill -f "blockchain-resolution-backfill.ts" || true
sleep 2

# Worker 1: Early sparse blocks (10M-30M) - Fast scan with larger batches
WORKER_ID=1 \
FROM_BLOCK=10000000 \
TO_BLOCK=30000000 \
BLOCKS_PER_BATCH=30000 \
RATE_LIMIT_MS=40 \
npx tsx blockchain-resolution-backfill.ts > blockchain-worker-1.log 2>&1 &
W1_PID=$!
echo "✓ Worker 1 started (PID $W1_PID) - Blocks 10M-30M"

# Worker 2: First dense range (30M-42M)
WORKER_ID=2 \
FROM_BLOCK=30000000 \
TO_BLOCK=42000000 \
BLOCKS_PER_BATCH=20000 \
RATE_LIMIT_MS=40 \
npx tsx blockchain-resolution-backfill.ts > blockchain-worker-2.log 2>&1 &
W2_PID=$!
echo "✓ Worker 2 started (PID $W2_PID) - Blocks 30M-42M"

# Worker 3: Second dense range (42M-54M)
WORKER_ID=3 \
FROM_BLOCK=42000000 \
TO_BLOCK=54000000 \
BLOCKS_PER_BATCH=20000 \
RATE_LIMIT_MS=40 \
npx tsx blockchain-resolution-backfill.ts > blockchain-worker-3.log 2>&1 &
W3_PID=$!
echo "✓ Worker 3 started (PID $W3_PID) - Blocks 42M-54M"

# Worker 4: Third dense range (54M-66M)
WORKER_ID=4 \
FROM_BLOCK=54000000 \
TO_BLOCK=66000000 \
BLOCKS_PER_BATCH=20000 \
RATE_LIMIT_MS=40 \
npx tsx blockchain-resolution-backfill.ts > blockchain-worker-4.log 2>&1 &
W4_PID=$!
echo "✓ Worker 4 started (PID $W4_PID) - Blocks 54M-66M"

# Worker 5: Latest dense range (66M-78M)
WORKER_ID=5 \
FROM_BLOCK=66000000 \
TO_BLOCK=78700000 \
BLOCKS_PER_BATCH=20000 \
RATE_LIMIT_MS=40 \
npx tsx blockchain-resolution-backfill.ts > blockchain-worker-5.log 2>&1 &
W5_PID=$!
echo "✓ Worker 5 started (PID $W5_PID) - Blocks 66M-78M"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "ALL WORKERS LAUNCHED"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Monitor progress:"
echo "  tail -f blockchain-worker-1.log  # Sparse era (fastest)"
echo "  tail -f blockchain-worker-2.log  # Dense era"
echo "  tail -f blockchain-worker-3.log  # Dense era"
echo "  tail -f blockchain-worker-4.log  # Dense era"
echo "  tail -f blockchain-worker-5.log  # Dense era (latest)"
echo ""
echo "Check all workers:"
echo "  ps aux | grep blockchain-resolution-backfill"
echo ""
echo "Worker PIDs:"
echo "  Worker 1: $W1_PID"
echo "  Worker 2: $W2_PID"
echo "  Worker 3: $W3_PID"
echo "  Worker 4: $W4_PID"
echo "  Worker 5: $W5_PID"
echo ""
echo "Workers will auto-resume from checkpoints if interrupted"
echo "Checkpoints: blockchain-backfill-checkpoint-{1-5}.json"
echo ""
echo "Estimated completion: 6-8 hours"
echo ""
