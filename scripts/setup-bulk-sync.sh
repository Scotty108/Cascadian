#!/bin/bash
# Setup script for Bulk Wallet Sync System
# This script prepares the database and verifies prerequisites

set -e

echo "=========================================="
echo "🚀 Bulk Wallet Sync System Setup"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js: $(node --version)${NC}"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ pnpm is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ pnpm: $(pnpm --version)${NC}"

# Check environment variables
if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ]; then
    echo -e "${RED}❌ NEXT_PUBLIC_SUPABASE_URL not set${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Supabase URL configured${NC}"

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo -e "${RED}❌ SUPABASE_SERVICE_ROLE_KEY not set${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Supabase service key configured${NC}"

if [ -z "$CLICKHOUSE_HOST" ]; then
    echo -e "${RED}❌ CLICKHOUSE_HOST not set${NC}"
    exit 1
fi
echo -e "${GREEN}✅ ClickHouse host configured${NC}"

# Test ClickHouse connection
echo ""
echo "🔌 Testing ClickHouse connection..."
if npx tsx scripts/test-clickhouse-connection.ts 2>&1 | grep -q "connected successfully"; then
    echo -e "${GREEN}✅ ClickHouse connection successful${NC}"
else
    echo -e "${RED}❌ ClickHouse connection failed${NC}"
    echo "Please check your ClickHouse credentials in .env.local"
    exit 1
fi

# Apply ClickHouse migrations
echo ""
echo "📊 Applying ClickHouse migrations..."
echo "This will create/update the trades_raw table with condition_id column"
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npx tsx -e "
import { clickhouse } from './lib/clickhouse/client.js'
import fs from 'fs'

async function applyMigrations() {
  const migrations = [
    './migrations/clickhouse/001_create_trades_table.sql',
    './migrations/clickhouse/002_add_metric_fields.sql',
    './migrations/clickhouse/003_add_condition_id.sql'
  ]

  for (const file of migrations) {
    if (!fs.existsSync(file)) {
      console.log(\`⏭️  Skipping \${file} (not found)\`)
      continue
    }
    console.log(\`📄 Applying \${file}...\`)
    const sql = fs.readFileSync(file, 'utf-8')
    await clickhouse.exec({ query: sql })
  }
  console.log('✅ ClickHouse migrations complete!')
}

applyMigrations()
"
else
    echo "Skipping ClickHouse migrations"
fi

# Apply Supabase migration
echo ""
echo "📊 Applying Supabase migration..."
echo "This will create the wallet_sync_metadata table"
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ -n "$DATABASE_URL" ]; then
        psql "$DATABASE_URL" -f supabase/migrations/20251025000000_create_wallet_sync_metadata.sql
        echo -e "${GREEN}✅ Supabase migration complete!${NC}"
    else
        echo -e "${YELLOW}⚠️  DATABASE_URL not set, please apply migration manually:${NC}"
        echo "psql \$DATABASE_URL -f supabase/migrations/20251025000000_create_wallet_sync_metadata.sql"
    fi
else
    echo "Skipping Supabase migration"
fi

# Verify tables exist
echo ""
echo "🔍 Verifying tables..."
if npx tsx -e "
import { clickhouse } from './lib/clickhouse/client.js'
const result = await clickhouse.query({ query: 'SHOW TABLES', format: 'JSONEachRow' })
const tables = await result.json()
console.log('ClickHouse tables:', tables.map(t => t.name).join(', '))
"; then
    echo -e "${GREEN}✅ ClickHouse tables verified${NC}"
fi

# Check wallet count
echo ""
echo "📊 Checking wallet count..."
npx tsx -e "
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { count, error } = await supabase.from('wallet_scores').select('*', { count: 'exact', head: true })
if (error) throw error
console.log(\`📈 Found \${count} wallets in wallet_scores table\`)
"

# Check market count
echo ""
echo "📊 Checking market count..."
npx tsx -e "
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { count, error } = await supabase.from('markets').select('*', { count: 'exact', head: true })
if (error) throw error
console.log(\`📈 Found \${count} markets in markets table\`)
const { count: withCategory } = await supabase.from('markets').select('*', { count: 'exact', head: true }).not('category', 'is', null)
console.log(\`📈 \${withCategory} markets have categories (\${((withCategory/count)*100).toFixed(1)}%)\`)
"

echo ""
echo "=========================================="
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Run a test sync with 10 wallets:"
echo "   npx tsx scripts/sync-all-wallets-bulk.ts --max-wallets 10 --dry-run"
echo ""
echo "2. Start the bulk sync (24-48 hours):"
echo "   npx tsx scripts/sync-all-wallets-bulk.ts"
echo ""
echo "3. Monitor progress in another terminal:"
echo "   watch -n 60 'cat .bulk-sync-checkpoint.json'"
echo ""
echo "4. After sync completes, calculate category omega:"
echo "   npx tsx scripts/calculate-category-omega-sql.ts"
echo ""
echo "5. Set up incremental sync cron job:"
echo "   0 * * * * cd $(pwd) && npx tsx scripts/sync-wallets-incremental.ts --top 100"
echo ""
echo "📚 Documentation: docs/BULK_WALLET_SYNC_SYSTEM.md"
echo ""
