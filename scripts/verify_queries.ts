import { getClickHouseClient } from './lib/clickhouse/client';

async function runQueries() {
  const client = getClickHouseClient();
  const timestamp = new Date().toISOString();
  
  try {
    console.log('=== CRITICAL VERIFICATION QUERIES ===');
    console.log('Timestamp:', timestamp);
    console.log('');
    
    console.log('=== QUERY 1: ERC-1155 Block Coverage ===\n');
    
    // Query 1a: Total rows and block range
    const q1a = await client.query({
      query: 'SELECT COUNT(*) as total_rows, MIN(block_number) as min_block, MAX(block_number) as max_block FROM default.erc1155_transfers',
      format: 'JSONCompact'
    });
    const q1aText = await q1a.text();
    const q1aData = JSON.parse(q1aText);
    console.log('Query 1a: SELECT COUNT(*), MIN(block_number), MAX(block_number) FROM erc1155_transfers');
    console.log('Result:', q1aData.data[0]);
    console.log('');
    
    // Query 1b: Rows before block 38000000
    const q1b = await client.query({
      query: 'SELECT COUNT(*) as rows_before_38m FROM default.erc1155_transfers WHERE block_number < 38000000',
      format: 'JSONCompact'
    });
    const q1bText = await q1b.text();
    const q1bData = JSON.parse(q1bText);
    console.log('Query 1b: SELECT COUNT(*) FROM erc1155_transfers WHERE block_number < 38000000');
    console.log('Result:', q1bData.data[0]);
    console.log('');
    
    console.log('=== QUERY 2: Trade Table Comparison ===\n');
    
    // Query 2: Compare trade tables
    const q2 = await client.query({
      query: "SELECT 'trades_raw' as table_name, COUNT(*) as row_count FROM default.trades_raw UNION ALL SELECT 'vw_trades_canonical' as table_name, COUNT(*) as row_count FROM default.vw_trades_canonical UNION ALL SELECT 'trades_with_direction' as table_name, COUNT(*) as row_count FROM default.trades_with_direction",
      format: 'JSONCompact'
    });
    const q2Text = await q2.text();
    const q2Data = JSON.parse(q2Text);
    console.log('Query 2: Trade table rowcount comparison (UNION ALL)');
    q2Data.data.forEach((row: any) => {
      console.log('  ' + row[0] + ': ' + (row[1] as number).toLocaleString() + ' rows');
    });
    console.log('');
    
    // Check if cascadian_clean.fact_trades_clean exists
    try {
      const q2b = await client.query({
        query: 'SELECT COUNT(*) as row_count FROM cascadian_clean.fact_trades_clean LIMIT 1',
        format: 'JSONCompact'
      });
      const q2bText = await q2b.text();
      const q2bData = JSON.parse(q2bText);
      console.log('Query 2b: cascadian_clean.fact_trades_clean exists - ' + q2bData.data[0][0] + ' rows');
    } catch (e) {
      console.log('Query 2b: cascadian_clean.fact_trades_clean - TABLE DOES NOT EXIST');
    }
    console.log('');
    
    console.log('=== QUERY 3: Test Wallet Coverage (0x4ce7...) ===\n');
    
    // Query 3a: Trades for test wallet
    const q3a = await client.query({
      query: "SELECT COUNT(*) as trade_count FROM default.vw_trades_canonical WHERE wallet_address_norm = '0x4ce73141dbfce41e65db3723e31059a730f0abad'",
      format: 'JSONCompact'
    });
    const q3aText = await q3a.text();
    const q3aData = JSON.parse(q3aText);
    console.log('Query 3a: SELECT COUNT(*) FROM vw_trades_canonical WHERE wallet_address_norm = 0x4ce7...');
    console.log('Result:', q3aData.data[0][0], 'trades');
    console.log('');
    
    // Query 3b: ERC1155 transfers
    const q3b = await client.query({
      query: "SELECT COUNT(*) as transfer_count FROM default.erc1155_transfers WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad' OR to_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'",
      format: 'JSONCompact'
    });
    const q3bText = await q3b.text();
    const q3bData = JSON.parse(q3bText);
    console.log('Query 3b: SELECT COUNT(*) FROM erc1155_transfers WHERE wallet_address OR to_address = 0x4ce7...');
    console.log('Result:', q3bData.data[0][0], 'transfers');
    console.log('');
    
    console.log('=== QUERY 4: Mapping Table Status ===\n');
    
    const mappingTables = [
      'default.ctf_token_map',
      'default.erc1155_condition_map', 
      'default.pm_erc1155_flats',
      'default.market_id_condition_mapping'
    ];
    
    for (const table of mappingTables) {
      try {
        const result = await client.query({
          query: 'SELECT COUNT(*) as row_count FROM ' + table,
          format: 'JSONCompact'
        });
        const text = await result.text();
        const data = JSON.parse(text);
        console.log(table + ': ' + (data.data[0][0] as number).toLocaleString() + ' rows');
      } catch (e) {
        console.log(table + ': TABLE DOES NOT EXIST');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

runQueries();
