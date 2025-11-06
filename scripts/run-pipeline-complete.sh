#!/bin/bash

# Complete Polymarket Data Pipeline Runbook
# This script executes all pipeline steps in the correct order to rebuild
# the complete trading dataset from blockchain and CLOB data.

set -e

export CONDITIONAL_TOKENS="0x4d97dcd97ec945f40cf65f87097ace5ea0476045"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "CASCADIAN POLYMARKET COMPLETE DATA PIPELINE"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This runbook will rebuild the complete trading dataset:"
echo "  1) Map EOAs to proxy wallets from on-chain ApprovalForAll events"
echo "  2) Decode ERC1155 conditional token transfers"
echo "  3) Map token IDs to actual markets via Gamma API"
echo "  4) Ingest trade fills from CLOB API"
echo "  5) Build position flows from ERC1155 transfers"
echo "  6) Calculate USDC funding flows (deposits/withdrawals)"
echo "  7) Validate against known wallets"
echo ""
echo "Prerequisites:"
echo "  - ClickHouse database configured and accessible"
echo "  - CLICKHOUSE_HOST, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD set"
echo ""

# Verify environment
if [ -z "$CLICKHOUSE_HOST" ]; then
  echo "❌ Error: CLICKHOUSE_HOST not set"
  exit 1
fi

echo "✅ ClickHouse configured: $CLICKHOUSE_HOST"
echo ""

# Step 0: Summary
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 0: Environment Setup"
echo "════════════════════════════════════════════════════════════════════"
echo "CONDITIONAL_TOKENS: $CONDITIONAL_TOKENS"
echo ""

# Step 1: Build EOA → Proxy mapping
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 1: Building EOA → Proxy Wallet Mapping from ApprovalForAll"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This step analyzes on-chain ApprovalForAll events to map real user"
echo "EOAs to their Polymarket proxy wallets. Polymarket uses a proxy pattern"
echo "where actual traders approve contract addresses to manage their positions."
echo ""
npx tsx scripts/build-approval-proxies.ts
echo ""

# Step 2: Flatten ERC1155
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 2: Decoding ERC1155 Conditional Token Transfers"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This step extracts and decodes ERC1155 TransferSingle and TransferBatch"
echo "events from the Polymarket ConditionalTokens contract. These transfers"
echo "represent actual trading positions, not USDC flows."
echo ""
npx tsx scripts/flatten-erc1155.ts
echo ""

# Step 3: Map token IDs to markets
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 3: Mapping Token IDs to Markets via Gamma API"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This step fetches market metadata from Gamma API and builds a lookup"
echo "table mapping token IDs (encoded condition ID + outcome index) to"
echo "actual market details and outcome labels."
echo ""
npx tsx scripts/map-tokenid-to-market.ts
echo ""

# Step 4: Build positions from ERC1155
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 4: Building Position Flows from ERC1155 Transfers"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This step aggregates ERC1155 transfers by proxy wallet and market"
echo "to calculate net positions, buy/sell counts, and trading activity."
echo ""
npx tsx scripts/build-positions-from-erc1155.ts
echo ""

# Step 5: Ingest CLOB fills
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 5: Ingesting Trade Fills from CLOB API"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This step fetches actual trade fills from Polymarket's CLOB API,"
echo "which provides execution prices and precise trade history for PnL"
echo "calculation. Fills are the ground truth for trade data."
echo ""
npx tsx scripts/ingest-clob-fills.ts
echo ""

# Step 6: Calculate USDC flows
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 6: Calculating USDC Funding Flows"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This step calculates USDC deposits and withdrawals for each proxy."
echo "Note: These are FUNDING flows only, not trading volume. Trades happen"
echo "via ERC1155 conditional tokens, not USDC transfers."
echo ""
npx tsx scripts/usdc-cashflows.ts
echo ""

# Step 7: Validation
echo "════════════════════════════════════════════════════════════════════"
echo "STEP 7: Validating Against Known Wallets"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "This step validates the pipeline by comparing trade counts from CLOB"
echo "API against known Polymarket wallets. Accuracy percentage shows how"
echo "complete our data capture is."
echo ""
npx tsx scripts/validate-three.ts
echo ""

echo "════════════════════════════════════════════════════════════════════"
echo "✅ PIPELINE COMPLETE"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Review validation results - accuracy % should be >80%"
echo "  2. Check ClickHouse tables for data volume and completeness"
echo "  3. Run PnL calculations using pm_trades (CLOB) and pm_tokenid_market_map"
echo "  4. Compare CLOB-based PnL against Polymarket profiles"
echo ""
