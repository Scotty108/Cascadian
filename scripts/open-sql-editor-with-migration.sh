#!/bin/bash
#
# Open Supabase SQL Editor and Display Migration
#
# This script:
# 1. Opens the Supabase SQL Editor in your browser
# 2. Displays the migration SQL with instructions
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Copy Trading Migration - SQL Editor Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Open SQL Editor
SQL_EDITOR_URL="https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new"
echo -e "${YELLOW}Opening Supabase SQL Editor...${NC}"
echo -e "${BLUE}$SQL_EDITOR_URL${NC}"
echo ""

# Open in default browser (works on macOS)
if command -v open &> /dev/null; then
  open "$SQL_EDITOR_URL"
else
  echo "Please open this URL manually: $SQL_EDITOR_URL"
fi

sleep 2

# Display the migration file path
MIGRATION_FILE="supabase/migrations/20251029000001_create_copy_trading_tables.sql"
echo -e "${YELLOW}Migration file location:${NC}"
echo -e "${BLUE}$(pwd)/$MIGRATION_FILE${NC}"
echo ""

# Ask if they want to see the migration
echo -e "${YELLOW}Would you like to:${NC}"
echo "  1) Copy the migration SQL to clipboard (recommended)"
echo "  2) Display the migration SQL in terminal"
echo "  3) Skip (I'll open it manually)"
echo ""
read -p "Enter choice (1-3): " choice

case $choice in
  1)
    if command -v pbcopy &> /dev/null; then
      cat "$MIGRATION_FILE" | pbcopy
      echo ""
      echo -e "${GREEN}✅ Migration SQL copied to clipboard!${NC}"
      echo ""
      echo -e "${YELLOW}Next steps:${NC}"
      echo "  1. Switch to the Supabase SQL Editor tab"
      echo "  2. Paste (CMD+V) the migration SQL"
      echo "  3. Click 'Run' or press CMD+Enter"
      echo "  4. Come back and run: npm run verify:copy-trading"
    else
      echo "pbcopy not found. Please copy manually from: $MIGRATION_FILE"
    fi
    ;;
  2)
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}Migration SQL:${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    cat "$MIGRATION_FILE"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    ;;
  3)
    echo ""
    echo -e "${YELLOW}Manual steps:${NC}"
    echo "  1. Open: $MIGRATION_FILE"
    echo "  2. Copy the contents"
    echo "  3. Paste into Supabase SQL Editor"
    echo "  4. Run the migration"
    echo "  5. Run verification: npm run verify:copy-trading"
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
