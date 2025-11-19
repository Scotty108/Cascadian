import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

clickhouse.query({
  query: "SELECT name FROM system.columns WHERE database=currentDatabase() AND table='clob_fills' AND name LIKE '%fee%'",
  format: 'JSONEachRow'
}).then(r => r.json())
  .then(d => console.log('Fee fields:', d.map((x: any) => x.name).join(', ') || 'NONE'))
  .catch(console.error);
