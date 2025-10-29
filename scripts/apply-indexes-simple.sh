#!/bin/bash
# Simple script to show how to apply indexes

echo "📋 Database Indexes Migration"
echo "=============================="
echo ""
echo "To apply the indexes to your Supabase database:"
echo ""
echo "1. Open Supabase Dashboard → SQL Editor"
echo "2. Copy and paste the contents of:"
echo "   migrations/supabase/002_add_market_indexes.sql"
echo "3. Click 'Run'"
echo ""
echo "Or use psql:"
echo "   psql \$DATABASE_URL < migrations/supabase/002_add_market_indexes.sql"
echo ""
echo "Expected result: 10 indexes created in ~10 seconds"
echo "Performance gain: 3-5x faster queries"
echo ""
