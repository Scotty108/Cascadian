#!/bin/bash
# Full Historical Backfill - Cascadian Data Pipeline
# Fills the Dec 2022-May 2024 gap (and any future gaps)
# Expected runtime: 4-6 hours
# Expected result: 2,816 markets for wallet 0x4ce7 (vs current 31)

set -e  # Exit on error
set -o pipefail  # Fail on pipe errors

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKER_COUNT_ERC1155=${WORKER_COUNT_ERC1155:-16}
WORKER_COUNT_ERC20=${WORKER_COUNT_ERC20:-8}
RPC_SLEEP=${RPC_SLEEP:-50}
LOG_DIR="./backfill-logs"

# Create log directory
mkdir -p "$LOG_DIR"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if .env.local exists
    if [ ! -f ".env.local" ]; then
        log_error ".env.local not found. Please create it with ClickHouse credentials."
        exit 1
    fi

    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Please install Node.js."
        exit 1
    fi

    log_success "Prerequisites check passed"
}

get_current_row_count() {
    local table=$1
    npx tsx -e "
        import { createClient } from '@clickhouse/client';
        import { config } from 'dotenv';
        import { resolve } from 'path';
        config({ path: resolve(process.cwd(), '.env.local') });

        const ch = createClient({
            url: process.env.CLICKHOUSE_HOST,
            username: process.env.CLICKHOUSE_USER,
            password: process.env.CLICKHOUSE_PASSWORD,
        });

        (async () => {
            try {
                const result = await ch.query({
                    query: 'SELECT count() as rows FROM $table',
                    format: 'JSONEachRow',
                });
                const data = await result.json();
                console.log(data[0].rows);
            } catch (e) {
                console.log('0');
            }
            await ch.close();
        })();
    " 2>/dev/null | tail -1
}

# Main execution
main() {
    echo ""
    echo "================================================================================"
    echo "           CASCADIAN FULL HISTORICAL BACKFILL"
    echo "================================================================================"
    echo ""
    echo "This will backfill all historical data from December 18, 2022 to present."
    echo "Estimated time: 4-6 hours"
    echo ""
    echo "Configuration:"
    echo "  ERC1155 workers: $WORKER_COUNT_ERC1155"
    echo "  ERC20 workers: $WORKER_COUNT_ERC20"
    echo "  RPC sleep (ms): $RPC_SLEEP"
    echo "  Log directory: $LOG_DIR"
    echo ""
    echo "================================================================================"
    echo ""

    # Check prerequisites
    check_prerequisites

    # Get baseline counts
    log_info "Getting baseline row counts..."
    BASELINE_ERC1155=$(get_current_row_count "erc1155_transfers")
    BASELINE_ERC20=$(get_current_row_count "erc20_transfers_staging")
    log_info "Current erc1155_transfers: $BASELINE_ERC1155 rows"
    log_info "Current erc20_transfers_staging: $BASELINE_ERC20 rows"
    echo ""

    # Confirm before starting
    read -p "Continue with backfill? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "Backfill cancelled by user"
        exit 0
    fi
    echo ""

    # Phase 1: ERC1155 Conditional Token Transfers
    echo "================================================================================"
    echo "PHASE 1: ERC1155 Conditional Token Transfers"
    echo "================================================================================"
    echo ""
    log_info "Starting ERC1155 backfill with $WORKER_COUNT_ERC1155 workers..."
    log_info "This will take approximately 2-3 hours"
    log_info "Log: $LOG_DIR/phase1-erc1155.log"
    echo ""

    WORKER_COUNT=$WORKER_COUNT_ERC1155 \
    RPC_SLEEP=$RPC_SLEEP \
    npx tsx scripts/phase2-full-erc1155-backfill-turbo.ts 2>&1 | tee "$LOG_DIR/phase1-erc1155.log"

    if [ $? -eq 0 ]; then
        NEW_ERC1155=$(get_current_row_count "erc1155_transfers")
        ADDED_ERC1155=$((NEW_ERC1155 - BASELINE_ERC1155))
        log_success "Phase 1 complete! Added $ADDED_ERC1155 rows to erc1155_transfers"
    else
        log_error "Phase 1 failed! Check $LOG_DIR/phase1-erc1155.log for details"
        exit 1
    fi
    echo ""

    # Phase 2: ERC20 USDC Transfers
    echo "================================================================================"
    echo "PHASE 2: ERC20 USDC Transfers"
    echo "================================================================================"
    echo ""
    log_info "Starting ERC20 backfill with $WORKER_COUNT_ERC20 parallel workers..."
    log_info "This will take approximately 2-3 hours"
    log_info "Logs: $LOG_DIR/phase2-erc20-worker-*.log"
    echo ""

    # Start all workers in parallel
    for i in $(seq 0 $((WORKER_COUNT_ERC20 - 1))); do
        log_info "Starting worker $i/$((WORKER_COUNT_ERC20 - 1))..."
        SHARDS=$WORKER_COUNT_ERC20 \
        SHARD_ID=$i \
        npx tsx scripts/step3-streaming-backfill-parallel.ts > "$LOG_DIR/phase2-erc20-worker-$i.log" 2>&1 &
    done

    # Wait for all workers to complete
    log_info "Waiting for all workers to complete..."
    wait

    if [ $? -eq 0 ]; then
        NEW_ERC20=$(get_current_row_count "erc20_transfers_staging")
        ADDED_ERC20=$((NEW_ERC20 - BASELINE_ERC20))
        log_success "Phase 2 complete! Added $ADDED_ERC20 rows to erc20_transfers_staging"
    else
        log_error "Phase 2 failed! Check $LOG_DIR/phase2-erc20-worker-*.log for details"
        exit 1
    fi
    echo ""

    # Decode ERC20 transfers
    log_info "Decoding ERC20 transfers..."
    npx tsx scripts/phase1-batched-by-month.ts 2>&1 | tee "$LOG_DIR/phase2-erc20-decode.log"
    log_success "ERC20 decoding complete"
    echo ""

    # Phase 3: Flatten & Extract
    echo "================================================================================"
    echo "PHASE 3: Flatten & Extract"
    echo "================================================================================"
    echo ""

    log_info "Flattening ERC1155 transfers..."
    npx tsx scripts/flatten-erc1155-correct.ts 2>&1 | tee "$LOG_DIR/phase3-flatten.log"
    log_success "Flattening complete"
    echo ""

    log_info "Extracting condition IDs..."
    npx tsx worker-erc1155-condition-ids.ts 2>&1 | tee "$LOG_DIR/phase3-extract.log"
    log_success "Extraction complete"
    echo ""

    log_info "Rebuilding canonical trade views..."
    npx tsx scripts/rebuild-fact-trades-from-canonical.ts 2>&1 | tee "$LOG_DIR/phase3-rebuild.log"
    log_success "Rebuild complete"
    echo ""

    # Final validation
    echo "================================================================================"
    echo "VALIDATION"
    echo "================================================================================"
    echo ""

    log_info "Running validation checks..."

    # Check wallet coverage
    log_info "Checking wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad coverage..."
    npx tsx trace-wallet-data.ts 2>&1 | tee "$LOG_DIR/validation.log"

    echo ""
    echo "================================================================================"
    echo "BACKFILL COMPLETE!"
    echo "================================================================================"
    echo ""
    log_success "ERC1155 rows added: $ADDED_ERC1155"
    log_success "ERC20 rows added: $ADDED_ERC20"
    echo ""
    echo "Next steps:"
    echo "1. Review validation output above"
    echo "2. Check wallet P&L with: npx tsx trace-wallet-data.ts"
    echo "3. Verify market coverage matches Polymarket"
    echo ""
    echo "Logs saved to: $LOG_DIR/"
    echo ""
}

# Run main function
main