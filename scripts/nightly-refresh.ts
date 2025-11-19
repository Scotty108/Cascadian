#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { spawn } from 'child_process'
import { getClickHouseClient } from '../lib/clickhouse/client'

interface Step {
  id: string
  title: string
  command: string
  args: string[]
  required?: boolean
  skipIfEnv?: string
  verification?: () => Promise<void>
}

const ch = getClickHouseClient()

const MIN_ERC1155_ROWS = Number(process.env.REFRESH_MIN_ERC1155_ROWS ?? 5_000_000)
const MIN_FLATS_ROWS = Number(process.env.REFRESH_MIN_ERC1155_FLATS_ROWS ?? 1_000_000)
const MIN_FACT_ROWS = Number(process.env.REFRESH_MIN_FACT_ROWS ?? 100_000_000)

function parseCliFlags() {
  const skip = new Set<string>()
  for (const arg of process.argv.slice(2)) {
    const [flag, value] = arg.split('=')
    if ((flag === '--skip' || flag === '--skip-step') && value) {
      value.split(',').forEach(s => skip.add(s.trim()))
    }
  }
  if (process.env.REFRESH_SKIP_STEPS) {
    process.env.REFRESH_SKIP_STEPS.split(',').forEach(s => skip.add(s.trim()))
  }
  return skip
}

async function ensureRowCount(query: string, min: number, label: string) {
  const result = await ch.query({ query, format: 'JSONEachRow' })
  const rows = await result.json<Record<string, string>>()
  const value = Number(rows[0]?.count ?? rows[0]?.total ?? 0)
  if (Number.isNaN(value) || value < min) {
    throw new Error(`Gate failed for ${label}: expected >= ${min.toLocaleString()} but found ${value.toLocaleString()}`)
  }
  console.log(`✅ ${label} gate passed → ${value.toLocaleString()} rows`)
}

const steps: Step[] = [
  {
    id: 'backfill',
    title: 'ERC1155 backfill (blocks + raw transfers)',
    command: 'npx',
    args: ['tsx', 'scripts/phase2-erc1155-backfill-fixed.ts'],
    verification: async () => {
      await ensureRowCount('SELECT count() AS count FROM erc1155_transfers', MIN_ERC1155_ROWS, 'erc1155_transfers')
    },
  },
  {
    id: 'flatten',
    title: 'Flatten ERC1155 batches into pm_erc1155_flats',
    command: 'npx',
    args: ['tsx', 'scripts/flatten-erc1155.ts'],
    verification: async () => {
      await ensureRowCount('SELECT count() AS count FROM pm_erc1155_flats', MIN_FLATS_ROWS, 'pm_erc1155_flats')
    },
  },
  {
    id: 'wallet-map',
    title: 'Rebuild token + proxy mapping (build-system-wallet-map-v2)',
    command: 'npx',
    args: ['tsx', 'build-system-wallet-map-v2.ts'],
    verification: async () => {
      await ensureRowCount('SELECT count() AS count FROM ctf_token_map', 200_000, 'ctf_token_map')
    },
  },
  {
    id: 'fact',
    title: 'Rebuild fact_trades',
    command: 'npx',
    args: ['tsx', 'build-fact-trades.ts'],
    verification: async () => {
      await ensureRowCount('SELECT count() AS count FROM fact_trades', MIN_FACT_ROWS, 'fact_trades')
    },
  },
  {
    id: 'pnl-views',
    title: 'Rebuild realized/unrealized P&L views',
    command: 'npx',
    args: ['tsx', 'build-pnl-views.ts'],
    verification: async () => {
      await ensureRowCount('SELECT count() AS count FROM vw_total_pnl', 1, 'vw_total_pnl')
    },
  },
  {
    id: 'parity',
    title: 'Run Polymarket parity smoke test',
    command: 'npx',
    args: ['tsx', 'validate-polymarket-parity.ts'],
  },
]

async function runCommand(step: Step) {
  console.log(`\n${'='.repeat(90)}`)
  console.log(`▶️  STEP: ${step.title}`)
  console.log(`${'='.repeat(90)}\n`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      env: process.env,
    })

    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${step.id} exited with code ${code}`))
      }
    })
  })

  if (step.verification) {
    await step.verification()
  }
}

async function main() {
  const skip = parseCliFlags()
  const failures: string[] = []

  for (const step of steps) {
    if (skip.has(step.id)) {
      console.log(`⏭️  Skipping step "${step.id}" via flag/env`)
      continue
    }

    try {
      await runCommand(step)
      console.log(`✅ Completed step: ${step.title}`)
    } catch (error) {
      console.error(`❌ ${step.id} failed →`, (error as Error).message)
      failures.push(step.id)
      break
    }
  }

  if (failures.length > 0) {
    console.error(`\n❌ Nightly refresh halted. Failed steps: ${failures.join(', ')}`)
    process.exit(1)
  }

  console.log('\n🎉 Nightly refresh completed successfully!')
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal error in nightly refresh:', err)
  process.exit(1)
})
