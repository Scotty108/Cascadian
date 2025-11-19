-- Direct SQL analysis of ERC20 USDC transfers for xcnstrategy wallet
SELECT
  'TOTAL INFLOWS' as metric,
  sum(amount_usdc) as value_usd
FROM default.erc20_transfers_decoded
WHERE lower(to_address) IN ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723')
AND lower(from_address) NOT IN ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723')
AND amount_usdc > 0
UNION ALL
SELECT
  'TOTAL OUTFLOWS' as metric,
  sum(amount_usdc) as value_usd
FROM default.erc20_transfers_decoded
WHERE lower(from_address) IN ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723')
AND lower(to_address) NOT IN ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723')
AND amount_usdc > 0
UNION ALL
SELECT
  'TRANSFER COUNT' as metric,
  count(*) as value_usd
FROM default.erc20_transfers_decoded
WHERE (
  lower(to_address) IN ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723')
  OR lower(from_address) IN ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723')
)
AND amount_usdc > 0;
