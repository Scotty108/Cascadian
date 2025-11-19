#!/bin/bash
set -e

# Rebuild P&L Pipeline using ClickHouse CLI
# This script uses clickhouse-client to avoid Node.js HTTP header limitations
# Run time: ~15-30 minutes total

echo "================================================================================"
echo "REBUILD P&L PIPELINE FROM SOURCE OF TRUTH (CLI VERSION)"
echo "================================================================================"
echo "Started: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Phantom condition test: 03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4"
echo "Target wallet test: 0x7f3c8979d0afa00007bae4747d5347122af05613"
echo "================================================================================"
echo ""

# Source .env.local for credentials
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

# ClickHouse connection details
CH_HOST="${CLICKHOUSE_HOST:-localhost}"
CH_PORT="${CLICKHOUSE_PORT:-8123}"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"
CH_DB="${CLICKHOUSE_DB:-default}"

# Build clickhouse-client command
if [ -n "$CH_PASS" ]; then
  CH_CMD="clickhouse-client --host=$CH_HOST --port=$CH_PORT --user=$CH_USER --password=$CH_PASS --database=$CH_DB"
else
  CH_CMD="clickhouse-client --host=$CH_HOST --port=$CH_PORT --user=$CH_USER --database=$CH_DB"
fi

echo "STAGE 1: Rebuilding trade_cashflows_v3 from vw_clob_fills_enriched"
echo ""
echo "Step 1a: Check source table..."
echo ""

SOURCE_STATS=$($CH_CMD --query="
  SELECT
    formatReadableQuantity(count()) as total_fills,
    formatReadableQuantity(uniq(user_eoa)) as unique_wallets,
    formatReadableQuantity(uniq(\`cf.condition_id\`)) as unique_markets
  FROM vw_clob_fills_enriched
  FORMAT TSV
")

echo "Source table (vw_clob_fills_enriched):"
echo "  Total fills: $(echo $SOURCE_STATS | cut -f1)"
echo "  Unique wallets: $(echo $SOURCE_STATS | cut -f2)"
echo "  Unique markets: $(echo $SOURCE_STATS | cut -f3)"
echo ""

echo "Step 1b: Creating trade_cashflows_v3_fixed..."
echo ""
echo "This will take 5-15 minutes..."
echo ""

STAGE1_START=$(date +%s)
$CH_CMD < tmp/rebuild-stage1-create-cashflows.sql

STAGE1_END=$(date +%s)
STAGE1_DURATION=$((STAGE1_END - STAGE1_START))

echo "✅ trade_cashflows_v3_fixed created in ${STAGE1_DURATION}s"
echo ""

# Validation 1: Row count
echo "Step 1c: Validating row count..."
echo ""

NEW_COUNT=$($CH_CMD --query="SELECT formatReadableQuantity(count()) FROM trade_cashflows_v3_fixed FORMAT TSV")
echo "  New table rows: $NEW_COUNT"
echo ""

# Validation 2: Phantom condition test
echo "Step 1d: Testing phantom condition..."
echo ""
echo "  Phantom: 03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4"
echo ""

PHANTOM_WALLETS=$($CH_CMD --query="
  SELECT count(DISTINCT wallet)
  FROM trade_cashflows_v3_fixed
  WHERE condition_id_norm = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'
  FORMAT TSV
")

echo "  Wallets in fixed table: $PHANTOM_WALLETS (expected: 5)"

if [ "$PHANTOM_WALLETS" = "5" ]; then
  echo "  ✅ VALIDATION PASSED - Phantom condition fixed!"
else
  echo "  ❌ VALIDATION FAILED - Expected 5 wallets, got $PHANTOM_WALLETS"
  echo ""
  echo "⚠️  REBUILD FAILED VALIDATION - Stopping here"
  exit 1
fi
echo ""

# Validation 3: Target wallet test
echo "Step 1e: Testing target wallet..."
echo ""

TARGET_CONDITIONS=$($CH_CMD --query="
  SELECT count(DISTINCT condition_id_norm)
  FROM trade_cashflows_v3_fixed
  WHERE wallet = '0x7f3c8979d0afa00007bae4747d5347122af05613'
  FORMAT TSV
")

echo "  Target wallet conditions: $TARGET_CONDITIONS (expected: ~36, not 134)"
echo ""

if [ "$TARGET_CONDITIONS" -lt 50 ]; then
  echo "  ✅ Target wallet looks clean (no longer 134 phantom markets)"
else
  echo "  ⚠️  Warning: Target wallet still has many conditions ($TARGET_CONDITIONS)"
fi
echo ""

echo "================================================================================"
echo "STAGE 2: Atomic Table Swap"
echo "================================================================================"
echo ""
echo "This will rename:"
echo "  trade_cashflows_v3 → trade_cashflows_v3_corrupted"
echo "  trade_cashflows_v3_fixed → trade_cashflows_v3"
echo ""

read -p "Proceed with swap? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Aborted by user"
  exit 1
fi

STAGE2_START=$(date +%s)
$CH_CMD < tmp/rebuild-stage2-swap-tables.sql
STAGE2_END=$(date +%s)
STAGE2_DURATION=$((STAGE2_END - STAGE2_START))

echo "✅ Tables swapped in ${STAGE2_DURATION}s"
echo ""

# Verify swap
CANONICAL_COUNT=$($CH_CMD --query="SELECT formatReadableQuantity(count()) FROM trade_cashflows_v3 FORMAT TSV")
echo "Canonical table (trade_cashflows_v3) now has: $CANONICAL_COUNT rows"
echo ""

echo "================================================================================"
echo "STAGE 3: Rebuilding outcome_positions_v2"
echo "================================================================================"
echo ""

STAGE3_START=$(date +%s)
$CH_CMD < tmp/rebuild-stage3-positions.sql
STAGE3_END=$(date +%s)
STAGE3_DURATION=$((STAGE3_END - STAGE3_START))

POSITIONS_COUNT=$($CH_CMD --query="SELECT formatReadableQuantity(count()) FROM outcome_positions_v2 FORMAT TSV")
echo "✅ outcome_positions_v2 rebuilt in ${STAGE3_DURATION}s"
echo "  Total positions: $POSITIONS_COUNT"
echo ""

echo "================================================================================"
echo "STAGE 4: Rebuilding realized_pnl_by_market_final"
echo "================================================================================"
echo ""

STAGE4_START=$(date +%s)
$CH_CMD < tmp/rebuild-stage4-realized-pnl.sql
STAGE4_END=$(date +%s)
STAGE4_DURATION=$((STAGE4_END - STAGE4_START))

PNL_COUNT=$($CH_CMD --query="SELECT formatReadableQuantity(count()) FROM realized_pnl_by_market_final FORMAT TSV")
echo "✅ realized_pnl_by_market_final rebuilt in ${STAGE4_DURATION}s"
echo "  Total P&L entries: $PNL_COUNT"
echo ""

echo "================================================================================"
echo "FINAL VALIDATION"
echo "================================================================================"
echo ""

# Check phantom condition in final output
FINAL_PHANTOM_CHECK=$($CH_CMD --query="
  SELECT count(*)
  FROM realized_pnl_by_market_final
  WHERE condition_id_norm = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'
    AND wallet = '0x7f3c8979d0afa00007bae4747d5347122af05613'
  FORMAT TSV
")

echo "Phantom condition in target wallet P&L: $FINAL_PHANTOM_CHECK (expected: 0)"
if [ "$FINAL_PHANTOM_CHECK" = "0" ]; then
  echo "✅ PHANTOM ELIMINATED from final P&L"
else
  echo "❌ WARNING: Phantom still present in final output!"
fi
echo ""

# Check target wallet total markets
TARGET_MARKETS_FINAL=$($CH_CMD --query="
  SELECT count(*)
  FROM realized_pnl_by_market_final
  WHERE wallet = '0x7f3c8979d0afa00007bae4747d5347122af05613'
  FORMAT TSV
")

echo "Target wallet total markets in P&L: $TARGET_MARKETS_FINAL (was 134, should be ~36)"
echo ""

TOTAL_DURATION=$((STAGE1_DURATION + STAGE2_DURATION + STAGE3_DURATION + STAGE4_DURATION))
echo "================================================================================"
echo "✅ REBUILD COMPLETE"
echo "================================================================================"
echo "Total time: ${TOTAL_DURATION}s (~$((TOTAL_DURATION / 60)) minutes)"
echo "Finished: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""
echo "Next steps:"
echo "1. Re-run Dome validation (compare to realized_pnl_by_market_backup_20251111)"
echo "2. Check if sign errors and magnitude inflation are fixed"
echo "3. Document results in tmp/SIGN_FIX_VALIDATION_RESULTS.md"
echo ""
echo "Corrupted table preserved as: trade_cashflows_v3_corrupted"
echo ""
