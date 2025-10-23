#!/bin/bash

#
# Complete Data Pipeline
#
# Runs the full data ingestion pipeline:
# 1. Discover all wallets from all markets
# 2. Process all wallets in the queue
# 3. Repeat continuously
#

set -e

echo "🚀 CASCADIAN Data Pipeline"
echo "======================================"
echo ""

# Step 1: Discovery
echo "📊 Step 1: Discovering all wallets..."
pnpm tsx --env-file=.env.local scripts/discover-all-wallets.ts

echo ""
echo "✅ Discovery complete!"
echo ""

# Step 2: Processing
echo "⚙️  Step 2: Processing wallet queue..."
pnpm tsx --env-file=.env.local scripts/process-wallet-queue.ts

echo ""
echo "✅ Processing complete!"
echo ""

# Summary
echo "======================================"
echo "✅ Pipeline execution complete!"
echo "======================================"
echo ""
echo "To run continuously:"
echo "  pnpm tsx --env-file=.env.local scripts/process-wallet-queue.ts --continuous"
echo ""
