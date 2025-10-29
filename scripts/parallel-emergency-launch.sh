#!/bin/bash
# Parallel Emergency Load Launcher
# Splits 65k wallets into chunks and processes in parallel for 10x speedup

WALLET_FILE="runtime/wallets_10k_plus_addresses.txt"
NUM_WORKERS=10
RUNTIME_DIR="runtime"

echo "🚀 PARALLEL EMERGENCY LOAD - 10x Speedup"
echo "=========================================="
echo ""

# Count total wallets
TOTAL_WALLETS=$(wc -l < "$WALLET_FILE")
echo "📊 Total wallets: $TOTAL_WALLETS"

# Calculate chunk size
CHUNK_SIZE=$(( ($TOTAL_WALLETS + $NUM_WORKERS - 1) / $NUM_WORKERS ))
echo "📦 Chunk size: $CHUNK_SIZE wallets per worker"
echo "⚡ Workers: $NUM_WORKERS parallel processes"
echo ""

# Create chunks directory
mkdir -p "$RUNTIME_DIR/chunks"

# Split wallet file into chunks
echo "✂️  Splitting wallet list into $NUM_WORKERS chunks..."
split -l $CHUNK_SIZE "$WALLET_FILE" "$RUNTIME_DIR/chunks/chunk_"

# Rename chunks with numbers
i=0
for chunk in $RUNTIME_DIR/chunks/chunk_*; do
    mv "$chunk" "$RUNTIME_DIR/chunks/wallets_chunk_$i.txt"
    i=$((i + 1))
done

echo "✅ Created $i chunks"
echo ""
echo "🚀 Launching $NUM_WORKERS parallel workers..."
echo ""

# Launch parallel workers
for i in $(seq 0 $(($NUM_WORKERS - 1))); do
    CHUNK_FILE="$RUNTIME_DIR/chunks/wallets_chunk_$i.txt"
    LOG_FILE="$RUNTIME_DIR/emergency-worker-$i.log"
    CHECKPOINT_FILE="$RUNTIME_DIR/emergency-worker-$i.checkpoint.json"

    if [ -f "$CHUNK_FILE" ]; then
        echo "🔥 Worker $i: Processing $(wc -l < $CHUNK_FILE) wallets → $LOG_FILE"

        # Launch in background
        npx tsx scripts/goldsky-emergency-load.ts \
            --wallets-file="$CHUNK_FILE" \
            --checkpoint="$CHECKPOINT_FILE" \
            > "$LOG_FILE" 2>&1 &

        PID=$!
        echo "   PID: $PID"
        echo $PID > "$RUNTIME_DIR/worker-$i.pid"
    fi
done

echo ""
echo "✅ All workers launched!"
echo ""
echo "📊 Monitor progress:"
echo "   tail -f runtime/emergency-worker-*.log"
echo ""
echo "🔍 Check status:"
echo "   grep -h 'Processing:' runtime/emergency-worker-*.log | tail -20"
echo ""
echo "⏱️  Estimated completion: 1-3 hours"
echo ""
echo "🛑 To kill all workers:"
echo "   kill \$(cat runtime/worker-*.pid)"
