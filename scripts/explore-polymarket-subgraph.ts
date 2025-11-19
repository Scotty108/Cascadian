#!/usr/bin/env tsx
/**
 * Explore Polymarket Subgraph Schema
 *
 * Queries the Goldsky-hosted Polymarket PNL and Positions subgraphs to understand schema
 */

const PNL_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn';
const POSITIONS_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';

async function queryGraphQL(endpoint: string, query: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

async function main() {
  console.log('🔍 Exploring Polymarket Subgraph Schema');
  console.log('='.repeat(80));
  console.log('');

  // Introspection query to get schema
  const introspectionQuery = `
    {
      __schema {
        types {
          name
          kind
          fields {
            name
            type {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
      }
    }
  `;

  try {
    console.log('Querying PNL subgraph schema...');
    const pnlSchema = await queryGraphQL(PNL_ENDPOINT, introspectionQuery);

    // Filter to entity types only
    const pnlEntities = pnlSchema.data.__schema.types
      .filter((t: any) => t.kind === 'OBJECT' && !t.name.startsWith('_'))
      .map((t: any) => ({
        name: t.name,
        fields: t.fields?.map((f: any) => ({
          name: f.name,
          type: f.type.name || f.type.ofType?.name || 'complex'
        }))
      }));

    console.log('\nPNL Subgraph Entities:');
    console.log(JSON.stringify(pnlEntities, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('Querying Positions subgraph schema...');
    const positionsSchema = await queryGraphQL(POSITIONS_ENDPOINT, introspectionQuery);

    const positionsEntities = positionsSchema.data.__schema.types
      .filter((t: any) => t.kind === 'OBJECT' && !t.name.startsWith('_'))
      .map((t: any) => ({
        name: t.name,
        fields: t.fields?.map((f: any) => ({
          name: f.name,
          type: f.type.name || f.type.ofType?.name || 'complex'
        }))
      }));

    console.log('\nPositions Subgraph Entities:');
    console.log(JSON.stringify(positionsEntities, null, 2));

  } catch (error) {
    console.error('Error querying subgraph:', error);
  }
}

main();
