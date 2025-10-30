#!/bin/bash
# Create all 6 copy trading strategies in the database

echo "════════════════════════════════════════════════════════════════════"
echo "  Creating All 6 Copy Trading Strategies"
echo "════════════════════════════════════════════════════════════════════"
echo ""

echo "1️⃣  Creating Mirror All strategy..."
npx tsx scripts/create-copy-strategy-mirror-all.ts
echo ""

echo "2️⃣  Creating Consensus Only strategy..."
npx tsx scripts/create-elite-copy-trading-strategy.ts
echo ""

echo "3️⃣  Creating Top Performer strategy..."
npx tsx scripts/create-copy-strategy-top-performer.ts
echo ""

echo "4️⃣  Creating Weighted Portfolio strategy..."
npx tsx scripts/create-copy-strategy-weighted.ts
echo ""

echo "5️⃣  Creating Tier-Based strategy..."
npx tsx scripts/create-copy-strategy-tier-based.ts
echo ""

echo "6️⃣  Creating Hybrid strategy..."
npx tsx scripts/create-copy-strategy-hybrid.ts
echo ""

echo "════════════════════════════════════════════════════════════════════"
echo "  ✅ All 6 Copy Trading Strategies Created!"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "📚 Strategy Library Now Contains:"
echo "  1. Copy Trading - Mirror All (Politics)"
echo "  2. Copy Trading - Consensus Only (Politics)"
echo "  3. Copy Trading - Top Performer (Politics)"
echo "  4. Copy Trading - Weighted Portfolio (Politics)"
echo "  5. Copy Trading - Tier-Based (Politics)"
echo "  6. Copy Trading - Hybrid (Politics)"
echo ""
echo "🚀 Next Steps:"
echo "  1. Open Strategy Builder in the UI"
echo "  2. Click 'Load from Library'"
echo "  3. Select any of the 6 copy trading strategies"
echo "  4. Review the node graph and configuration"
echo "  5. Deploy to paper trading to test"
echo ""
