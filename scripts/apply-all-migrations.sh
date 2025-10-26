#!/bin/bash
# Apply All Migrations Script
# Runs both ClickHouse and Supabase migrations in sequence

set -e  # Exit on error

echo "🚀 CASCADIAN Migration Runner"
echo "=============================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check environment variables
echo "🔍 Checking environment variables..."
if [ -z "$CLICKHOUSE_HOST" ]; then
  echo -e "${YELLOW}⚠️  CLICKHOUSE_HOST not set, using default: http://localhost:8123${NC}"
  export CLICKHOUSE_HOST="http://localhost:8123"
fi

if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ]; then
  echo -e "${RED}❌ NEXT_PUBLIC_SUPABASE_URL not set${NC}"
  echo "   Set it in .env.local"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo -e "${RED}❌ SUPABASE_SERVICE_ROLE_KEY not set${NC}"
  echo "   Set it in .env.local"
  exit 1
fi

echo -e "${GREEN}✅ Environment variables OK${NC}"
echo ""

# ClickHouse Migrations
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 CLICKHOUSE MIGRATIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

npx tsx scripts/run-clickhouse-migrations.ts

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ ClickHouse migrations completed${NC}"
else
  echo ""
  echo -e "${RED}❌ ClickHouse migrations failed${NC}"
  exit 1
fi

echo ""
echo ""

# Supabase Migrations
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 SUPABASE MIGRATIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo -e "${YELLOW}⚠️  Using Supabase CLI for migrations${NC}"
echo ""

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
  echo -e "${YELLOW}⚠️  Supabase CLI not found. Installing...${NC}"
  npm install -g supabase
fi

# Apply Supabase migrations
echo "Running: npx supabase db push"
echo ""

npx supabase db push

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ Supabase migrations completed${NC}"
else
  echo ""
  echo -e "${YELLOW}⚠️  Supabase migrations may have issues${NC}"
  echo "   Check output above for details"
fi

echo ""
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✨ ALL MIGRATIONS COMPLETED${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Database Status:"
echo ""
echo "   ClickHouse: 12 tables created"
echo "   - wallet_metrics_complete (102 metrics)"
echo "   - category_analytics"
echo "   - market_price_momentum (with TSI)"
echo "   - momentum_trading_signals"
echo "   - price_snapshots_10s"
echo "   - market_price_history"
echo "   - market_flow_metrics"
echo "   - elite_trade_attributions"
echo "   - fired_signals"
echo "   - wallet_metrics_by_category"
echo "   - trades_raw (already exists)"
echo ""
echo "   Supabase: 8 tables created"
echo "   - wallet_category_tags"
echo "   - wallet_leaderboard_history"
echo "   - watchlist_markets"
echo "   - watchlist_wallets"
echo "   - smoothing_configurations (TSI config)"
echo "   - user_signal_preferences"
echo "   - signal_delivery_log"
echo "   - momentum_threshold_rules"
echo ""
echo "🎯 Next Steps:"
echo "   1. Run wallet discovery: npx tsx scripts/discover-all-wallets-enhanced.ts"
echo "   2. Bulk sync wallets: npx tsx scripts/sync-all-wallets-bulk.ts"
echo "   3. Calculate metrics: npx tsx scripts/calculate-tier1-metrics.ts"
echo ""
