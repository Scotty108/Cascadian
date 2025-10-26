/**
 * Layout Persistence
 *
 * Task Group 18: Manual Layout Tools and Persistence
 *
 * Provides functions to save and load layout state (node positions and lock state)
 * for strategy workflows. Layout data is stored in the strategy_definitions table
 * as part of the workflow metadata.
 */

import { createClient } from '@supabase/supabase-js'

/**
 * Node position data
 */
export interface NodePosition {
  x: number
  y: number
}

/**
 * Layout state for a workflow
 */
export interface LayoutState {
  nodePositions: Record<string, NodePosition>
  layoutLocked: boolean
}

/**
 * Get Supabase client
 * Uses anon key for client-side operations (safe for browser)
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Save layout state to database
 *
 * @param strategyId - The strategy/workflow ID
 * @param positions - Node positions (optional, null to skip updating positions)
 * @param lockState - Layout lock state (optional, undefined to skip updating lock)
 */
export async function saveLayoutState(
  strategyId: string,
  positions: Record<string, NodePosition> | null,
  lockState?: boolean
): Promise<void> {
  const supabase = getSupabaseClient()

  // Fetch existing strategy data
  const { data: existing, error: fetchError } = await supabase
    .from('strategy_definitions')
    .select('metadata')
    .eq('strategy_id', strategyId)
    .single()

  if (fetchError) {
    console.error('Error fetching strategy for layout save:', fetchError)
    throw new Error('Failed to fetch strategy data')
  }

  // Merge layout data into metadata
  const currentMetadata = existing?.metadata || {}
  const layoutData: any = currentMetadata.layout || {}

  if (positions !== null) {
    layoutData.nodePositions = positions
  }

  if (lockState !== undefined) {
    layoutData.layoutLocked = lockState
  }

  // Update metadata
  const updates = {
    metadata: {
      ...currentMetadata,
      layout: layoutData,
    },
    updated_at: new Date().toISOString(),
  }

  const { error: updateError } = await supabase
    .from('strategy_definitions')
    .update(updates)
    .eq('strategy_id', strategyId)

  if (updateError) {
    console.error('Error saving layout state:', updateError)
    throw new Error('Failed to save layout state')
  }
}

/**
 * Load layout state from database
 *
 * @param strategyId - The strategy/workflow ID
 * @returns Layout state with node positions and lock state
 */
export async function loadLayoutState(strategyId: string): Promise<LayoutState> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('strategy_definitions')
    .select('metadata')
    .eq('strategy_id', strategyId)
    .single()

  if (error) {
    console.error('Error loading layout state:', error)
    return {
      nodePositions: {},
      layoutLocked: false,
    }
  }

  const layoutData = data?.metadata?.layout || {}

  return {
    nodePositions: layoutData.nodePositions || {},
    layoutLocked: layoutData.layoutLocked || false,
  }
}

/**
 * Save node positions only (convenience method)
 *
 * @param strategyId - The strategy/workflow ID
 * @param positions - Node positions to save
 */
export async function saveNodePositions(
  strategyId: string,
  positions: Record<string, NodePosition>
): Promise<void> {
  await saveLayoutState(strategyId, positions, undefined)
}

/**
 * Save lock state only (convenience method)
 *
 * @param strategyId - The strategy/workflow ID
 * @param locked - Lock state to save
 */
export async function saveLockState(
  strategyId: string,
  locked: boolean
): Promise<void> {
  await saveLayoutState(strategyId, null, locked)
}
