#!/bin/bash
# Load environment variables and verify tables

# Load .env.local
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | grep -v '^$' | xargs)
fi

# Run the verification
npx tsx scripts/verify-copy-trading-tables.ts
