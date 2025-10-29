#!/bin/bash
# Load environment variables and run migration

# Load .env.local
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | grep -v '^$' | xargs)
fi

# Run the migration
npx tsx scripts/apply-copy-trading-migration.ts
