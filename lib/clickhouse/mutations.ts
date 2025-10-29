import { clickhouse } from './client'

/**
 * Mutation Management Utilities for ClickHouse
 *
 * ClickHouse has a limit of 1000 concurrent mutations. These utilities help manage
 * mutations when running large-scale data operations.
 */

export interface MutationStatus {
  pending: number
  completed: number
  failed: number
  total: number
}

/**
 * Get current mutation status from ClickHouse
 */
export async function getMutationStatus(): Promise<MutationStatus> {
  const result = await clickhouse.query({
    query: `
      SELECT
        countIf(is_done = 0) as pending,
        countIf(is_done = 1) as completed,
        countIf(is_done = 0 AND latest_fail_reason != '') as failed,
        count() as total
      FROM system.mutations
    `,
    format: 'JSONEachRow'
  })

  const data = await result.json() as unknown as Array<{
    pending: string
    completed: string
    failed: string
    total: string
  }>

  const row = data[0]
  return {
    pending: parseInt(row.pending),
    completed: parseInt(row.completed),
    failed: parseInt(row.failed),
    total: parseInt(row.total)
  }
}

/**
 * Wait for all pending mutations to complete
 *
 * @param options.pollIntervalMs - How often to check status (default: 5000ms)
 * @param options.timeoutMs - Maximum time to wait before throwing (default: 600000ms = 10 minutes)
 * @param options.verbose - Whether to log progress (default: true)
 * @returns The final mutation status
 */
export async function waitForNoPendingMutations(options: {
  pollIntervalMs?: number
  timeoutMs?: number
  verbose?: boolean
} = {}): Promise<MutationStatus> {
  const {
    pollIntervalMs = 5000,
    timeoutMs = 600000,
    verbose = true
  } = options

  const startTime = Date.now()
  let status = await getMutationStatus()

  while (status.pending > 0) {
    // Check timeout
    const elapsed = Date.now() - startTime
    if (elapsed > timeoutMs) {
      throw new Error(
        `Timeout waiting for mutations after ${elapsed}ms. ` +
        `Still pending: ${status.pending}, failed: ${status.failed}`
      )
    }

    if (verbose) {
      console.log(`   ⏳ Waiting for ${status.pending} mutations to complete...`)
      if (status.failed > 0) {
        console.warn(`   ⚠️  ${status.failed} mutations have failed`)
      }
    }

    // Wait before checking again
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    status = await getMutationStatus()
  }

  if (verbose) {
    console.log(`   ✅ All mutations complete`)
  }

  return status
}

/**
 * Check if it's safe to start a new mutation
 *
 * @param maxPending - Maximum pending mutations allowed (default: 900)
 * @returns true if safe to proceed, false if should wait
 */
export async function isSafeToMutate(maxPending: number = 900): Promise<boolean> {
  const status = await getMutationStatus()
  return status.pending < maxPending
}

/**
 * Wait until it's safe to start a new mutation (pending count below threshold)
 *
 * @param maxPending - Maximum pending mutations allowed (default: 900)
 * @param pollIntervalMs - How often to check status (default: 5000ms)
 * @param timeoutMs - Maximum time to wait (default: 600000ms = 10 minutes)
 * @param verbose - Whether to log progress (default: true)
 */
export async function waitUntilSafeToMutate(options: {
  maxPending?: number
  pollIntervalMs?: number
  timeoutMs?: number
  verbose?: boolean
} = {}): Promise<void> {
  const {
    maxPending = 900,
    pollIntervalMs = 5000,
    timeoutMs = 600000,
    verbose = true
  } = options

  const startTime = Date.now()
  let status = await getMutationStatus()

  while (status.pending >= maxPending) {
    const elapsed = Date.now() - startTime
    if (elapsed > timeoutMs) {
      throw new Error(
        `Timeout waiting for safe mutation threshold after ${elapsed}ms. ` +
        `Pending: ${status.pending}, threshold: ${maxPending}`
      )
    }

    if (verbose) {
      console.log(`   ⏳ Waiting for mutations to drop below ${maxPending} (currently ${status.pending})...`)
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    status = await getMutationStatus()
  }

  if (verbose) {
    console.log(`   ✅ Safe to mutate (${status.pending} pending < ${maxPending} threshold)`)
  }
}

/**
 * Get detailed information about pending mutations
 */
export async function getPendingMutationDetails(): Promise<Array<{
  database: string
  table: string
  mutation_id: string
  command: string
  create_time: string
  parts_to_do: number
  is_done: number
  latest_fail_reason: string
}>> {
  const result = await clickhouse.query({
    query: `
      SELECT
        database,
        table,
        mutation_id,
        command,
        create_time,
        parts_to_do,
        is_done,
        latest_fail_reason
      FROM system.mutations
      WHERE is_done = 0
      ORDER BY create_time ASC
    `,
    format: 'JSONEachRow'
  })

  return await result.json() as unknown as Array<{
    database: string
    table: string
    mutation_id: string
    command: string
    create_time: string
    parts_to_do: number
    is_done: number
    latest_fail_reason: string
  }>
}
