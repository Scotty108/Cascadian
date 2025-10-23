#!/bin/bash

# Polymarket Data-API Testing Script
# Usage: ./scripts/test-data-api.sh [WALLET_ADDRESS]

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default test address (will return empty arrays)
WALLET="${1:-0x0000000000000000000000000000000000000000}"
BASE_URL="http://localhost:3000"

echo -e "${YELLOW}Testing Polymarket Data-API Endpoints${NC}"
echo -e "${YELLOW}Wallet: ${WALLET}${NC}"
echo ""

# Test Positions
echo -e "${GREEN}[1/6] Testing Positions Endpoint...${NC}"
curl -s "${BASE_URL}/api/polymarket/wallet/${WALLET}/positions" | jq '.' || echo -e "${RED}Failed${NC}"
echo ""

# Test Trades
echo -e "${GREEN}[2/6] Testing Trades Endpoint...${NC}"
curl -s "${BASE_URL}/api/polymarket/wallet/${WALLET}/trades?limit=10" | jq '.' || echo -e "${RED}Failed${NC}"
echo ""

# Test Value
echo -e "${GREEN}[3/6] Testing Value Endpoint...${NC}"
curl -s "${BASE_URL}/api/polymarket/wallet/${WALLET}/value" | jq '.' || echo -e "${RED}Failed${NC}"
echo ""

# Test Closed Positions
echo -e "${GREEN}[4/6] Testing Closed Positions Endpoint...${NC}"
curl -s "${BASE_URL}/api/polymarket/wallet/${WALLET}/closed-positions?limit=10" | jq '.' || echo -e "${RED}Failed${NC}"
echo ""

# Test Activity
echo -e "${GREEN}[5/6] Testing Activity Endpoint...${NC}"
curl -s "${BASE_URL}/api/polymarket/wallet/${WALLET}/activity?limit=20" | jq '.' || echo -e "${RED}Failed${NC}"
echo ""

# Test Holders (need a market ID)
echo -e "${GREEN}[6/6] Testing Holders Endpoint...${NC}"
echo -e "${YELLOW}Getting a sample market token ID...${NC}"
TOKEN_ID=$(curl -s "https://gamma-api.polymarket.com/markets/12" | jq -r '.clobTokenIds' | jq -r '.[0]')
echo -e "${YELLOW}Using token ID: ${TOKEN_ID}${NC}"
curl -s "${BASE_URL}/api/polymarket/market/${TOKEN_ID}/holders?limit=5" | jq '.' || echo -e "${RED}Failed${NC}"
echo ""

echo -e "${GREEN}✅ Testing complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Find a real active wallet address from Polymarket.com"
echo "2. Run this script again: ./scripts/test-data-api.sh 0xREAL_ADDRESS"
echo "3. Check the JSON responses to document the structure"
echo "4. Report back any errors or unexpected results"
