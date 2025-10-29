#!/bin/bash

# Open Supabase SQL Editor for Copy Trading Migration
# This script opens the SQL editor and copies the migration SQL to clipboard

set -e

PROJECT_REF="cqvjfonlpqycmaonacvz"
MIGRATION_FILE="supabase/migrations/20251029000001_create_copy_trading_tables.sql"
SQL_EDITOR_URL="https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new"

echo "=============================================="
echo "Copy Trading Migration - SQL Editor Launcher"
echo "=============================================="
echo ""
echo "Due to network connectivity issues, we need to"
echo "execute the migration via the Supabase SQL Editor."
echo ""

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
fi

echo "✅ Migration file found"
echo ""

# Copy SQL to clipboard (macOS)
if command -v pbcopy &> /dev/null; then
    cat "$MIGRATION_FILE" | pbcopy
    echo "✅ Migration SQL copied to clipboard!"
    echo ""
fi

# Display instructions
echo "📋 INSTRUCTIONS:"
echo ""
echo "1. Opening Supabase SQL Editor in your browser..."
echo "   URL: $SQL_EDITOR_URL"
echo ""
echo "2. Paste the migration SQL (already in clipboard)"
echo "   Press Cmd+V or Ctrl+V"
echo ""
echo "3. Click 'RUN' or press Cmd+Enter"
echo ""
echo "4. Verify tables were created:"
echo "   You should see output showing:"
echo "   - 4 tables created"
echo "   - 3 views created"
echo "   - 3 triggers created"
echo ""
echo "5. After execution, run verification:"
echo "   npm run verify:copy-trading"
echo ""

# Open browser (macOS)
if command -v open &> /dev/null; then
    echo "Opening browser..."
    open "$SQL_EDITOR_URL"
    echo ""
elif command -v xdg-open &> /dev/null; then
    # Linux
    xdg-open "$SQL_EDITOR_URL"
fi

echo "=============================================="
echo "📄 Migration file location:"
echo "   $MIGRATION_FILE"
echo ""
echo "📝 Instructions saved to:"
echo "   EXECUTE_COPY_TRADING_MIGRATION.md"
echo "=============================================="
echo ""
echo "⏳ Waiting for you to execute the migration..."
echo "   Press ENTER when done, or Ctrl+C to cancel"
read -p ""

echo ""
echo "🔍 Running verification..."
npm run verify:copy-trading

echo ""
echo "✅ Migration process complete!"
