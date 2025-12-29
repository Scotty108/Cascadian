/**
 * WORKFLOW SESSION SERVICE
 *
 * Supabase client service for workflow session CRUD operations.
 * Provides type-safe methods for managing workflows and executions.
 *
 * Usage:
 *   import { workflowSessionService } from '@/lib/services/workflow-session-service'
 *   const workflows = await workflowSessionService.listWorkflows({ status: 'active' })
 */

import type {
  WorkflowSessionRow,
  WorkflowSessionInsert,
  WorkflowSessionUpdate,
  WorkflowSession,
  WorkflowExecutionRow,
  WorkflowExecutionInsert,
  WorkflowExecutionUpdate,
  WorkflowExecution,
  WorkflowSessionFilters,
  WorkflowExecutionFilters,
  WorkflowVersionHistoryItem,
  WorkflowExecutionStats,
  parseWorkflowSession,
  parseWorkflowExecution,
  toWorkflowSessionInsert,
  toWorkflowExecutionInsert,
} from '@/types/database'
import type { WorkflowNode, WorkflowEdge, WorkflowTrigger } from '@/types/workflow'
import { supabase } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/workflow/anonymous-user'

// Import parsers
import {
  parseWorkflowSession as parseSession,
  parseWorkflowExecution as parseExecution,
  toWorkflowSessionInsert as toSessionInsert,
  toWorkflowExecutionInsert as toExecutionInsert,
} from '@/types/database'

// ============================================================================
// WORKFLOW SESSION SERVICE
// ============================================================================

export const workflowSessionService = {
  /**
   * List workflows for the current user with optional filters
   */
  async listWorkflows(
    filters: WorkflowSessionFilters = {}
  ): Promise<{ data: WorkflowSession[]; error: Error | null }> {
    try {
      let query = supabase
        .from('workflow_sessions')
        .select('*')
        .eq('is_current_version', filters.isCurrentVersion ?? true)

      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status)
      }
      if (filters.isTemplate !== undefined) {
        query = query.eq('is_template', filters.isTemplate)
      }
      if (filters.isFavorite !== undefined) {
        query = query.eq('is_favorite', filters.isFavorite)
      }
      if (filters.folder) {
        query = query.eq('folder', filters.folder)
      }
      if (filters.tags && filters.tags.length > 0) {
        query = query.overlaps('tags', filters.tags)
      }
      if (filters.searchQuery) {
        query = query.or(`name.ilike.%${filters.searchQuery}%,description.ilike.%${filters.searchQuery}%`)
      }

      // Apply ordering
      const orderBy = filters.orderBy ?? 'updated_at'
      const orderDirection = filters.orderDirection ?? 'desc'
      query = query.order(orderBy, { ascending: orderDirection === 'asc' })

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit)
      }
      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit ?? 20) - 1)
      }

      const { data, error } = await query

      if (error) throw error

      // Parse database rows to application types
      const workflows = (data as WorkflowSessionRow[]).map(parseSession)

      return { data: workflows, error: null }
    } catch (error) {
      console.error('Error listing workflows:', error)
      return { data: [], error: error as Error }
    }
  },

  /**
   * Get a specific workflow by ID
   */
  async getWorkflow(
    workflowId: string
  ): Promise<{ data: WorkflowSession | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('workflow_sessions')
        .select('*')
        .eq('id', workflowId)
        .single()

      if (error) throw error

      const workflow = data ? parseSession(data as WorkflowSessionRow) : null

      return { data: workflow, error: null }
    } catch (error) {
      console.error('Error getting workflow:', error)
      return { data: null, error: error as Error }
    }
  },

  /**
   * Create a new workflow
   */
  async createWorkflow(
    workflow: {
      name: string
      description?: string
      nodes?: WorkflowNode[]
      edges?: WorkflowEdge[]
      trigger?: WorkflowTrigger
      variables?: Record<string, any>
      tags?: string[]
      folder?: string
      status?: 'draft' | 'active' | 'paused' | 'archived'
    }
  ): Promise<{ data: WorkflowSession | null; error: Error | null }> {
    try {
      // Get current user (or use anonymous ID for development)
      const { data: { user } } = await supabase.auth.getUser()
      const userId = getCurrentUserId(user?.id)

      // Convert to database insert format
      const insertData = toSessionInsert({
        userId,
        name: workflow.name,
        description: workflow.description,
        nodes: workflow.nodes ?? [],
        edges: workflow.edges ?? [],
        trigger: workflow.trigger,
        variables: workflow.variables ?? {},
        tags: workflow.tags ?? [],
        folder: workflow.folder,
        status: workflow.status ?? 'draft',
      })

      const { data, error } = await supabase
        .from('workflow_sessions')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error

      const created = data ? parseSession(data as WorkflowSessionRow) : null

      return { data: created, error: null }
    } catch (error) {
      console.error('Error creating workflow:', error)
      return { data: null, error: error as Error }
    }
  },

  /**
   * Update a workflow (in-place, no versioning)
   */
  async updateWorkflow(
    workflowId: string,
    updates: {
      name?: string
      description?: string
      nodes?: WorkflowNode[]
      edges?: WorkflowEdge[]
      trigger?: WorkflowTrigger
      variables?: Record<string, any>
      tags?: string[]
      folder?: string
      status?: 'draft' | 'active' | 'paused' | 'archived'
      isFavorite?: boolean
    }
  ): Promise<{ data: WorkflowSession | null; error: Error | null }> {
    try {
      // Convert camelCase to snake_case for database
      const updateData: Partial<WorkflowSessionUpdate> = {}
      if (updates.name !== undefined) updateData.name = updates.name
      if (updates.description !== undefined) updateData.description = updates.description
      if (updates.nodes !== undefined) updateData.nodes = updates.nodes
      if (updates.edges !== undefined) updateData.edges = updates.edges
      if (updates.trigger !== undefined) updateData.trigger = updates.trigger
      if (updates.variables !== undefined) updateData.variables = updates.variables
      if (updates.tags !== undefined) updateData.tags = updates.tags
      if (updates.folder !== undefined) updateData.folder = updates.folder
      if (updates.status !== undefined) updateData.status = updates.status
      if (updates.isFavorite !== undefined) updateData.is_favorite = updates.isFavorite

      const { data, error } = await supabase
        .from('workflow_sessions')
        .update(updateData)
        .eq('id', workflowId)
        .select()
        .single()

      if (error) throw error

      const updated = data ? parseSession(data as WorkflowSessionRow) : null

      return { data: updated, error: null }
    } catch (error) {
      console.error('Error updating workflow:', error)
      return { data: null, error: error as Error }
    }
  },

  /**
   * Create a new version of a workflow
   */
  async createVersion(
    workflowId: string,
    updates: {
      nodes?: WorkflowNode[]
      edges?: WorkflowEdge[]
      trigger?: WorkflowTrigger
      variables?: Record<string, any>
    }
  ): Promise<{ data: WorkflowSession | null; error: Error | null }> {
    try {
      // Step 1: Get current workflow
      const { data: current, error: fetchError } = await this.getWorkflow(workflowId)
      if (fetchError || !current) throw new Error('Workflow not found')

      // Step 2: Mark current version as non-current
      await supabase
        .from('workflow_sessions')
        .update({ is_current_version: false })
        .eq('id', workflowId)

      // Step 3: Create new version
      const newVersion: WorkflowSessionInsert = {
        user_id: current.userId,
        name: current.name,
        description: current.description ?? null,
        nodes: updates.nodes ?? current.nodes,
        edges: updates.edges ?? current.edges,
        trigger: updates.trigger ?? current.trigger ?? null,
        variables: updates.variables ?? current.variables,
        tags: current.tags,
        folder: current.folder ?? null,
        status: current.status,
        version: current.version + 1,
        is_current_version: true,
        parent_workflow_id: current.id,
      }

      const { data, error } = await supabase
        .from('workflow_sessions')
        .insert(newVersion)
        .select()
        .single()

      if (error) throw error

      const created = data ? parseSession(data as WorkflowSessionRow) : null

      return { data: created, error: null }
    } catch (error) {
      console.error('Error creating workflow version:', error)
      return { data: null, error: error as Error }
    }
  },

  /**
   * Delete a workflow (hard delete)
   */
  async deleteWorkflow(workflowId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('workflow_sessions')
        .delete()
        .eq('id', workflowId)

      if (error) throw error

      return { error: null }
    } catch (error) {
      console.error('Error deleting workflow:', error)
      return { error: error as Error }
    }
  },

  /**
   * Archive a workflow (soft delete)
   */
  async archiveWorkflow(workflowId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('workflow_sessions')
        .update({ status: 'archived' })
        .eq('id', workflowId)

      if (error) throw error

      return { error: null }
    } catch (error) {
      console.error('Error archiving workflow:', error)
      return { error: error as Error }
    }
  },

  /**
   * Duplicate a workflow using the database function
   */
  async duplicateWorkflow(
    sourceWorkflowId: string,
    newName: string
  ): Promise<{ data: string | null; error: Error | null }> {
    try {
      // Get current user (or use anonymous ID for development)
      const { data: { user } } = await supabase.auth.getUser()
      const userId = getCurrentUserId(user?.id)

      const { data, error } = await supabase.rpc('duplicate_workflow', {
        source_workflow_id: sourceWorkflowId,
        new_name: newName,
        target_user_id: userId,
      })

      if (error) throw error

      return { data: data as string, error: null }
    } catch (error) {
      console.error('Error duplicating workflow:', error)
      return { data: null, error: error as Error }
    }
  },

  /**
   * Toggle favorite status
   */
  async toggleFavorite(
    workflowId: string,
    isFavorite: boolean
  ): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('workflow_sessions')
        .update({ is_favorite: isFavorite })
        .eq('id', workflowId)

      if (error) throw error

      return { error: null }
    } catch (error) {
      console.error('Error toggling favorite:', error)
      return { error: error as Error }
    }
  },

  /**
   * Get version history for a workflow
   */
  async getVersionHistory(
    workflowName: string
  ): Promise<{ data: WorkflowVersionHistoryItem[]; error: Error | null }> {
    try {
      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('User not authenticated')

      const { data, error } = await supabase.rpc('get_workflow_version_history', {
        workflow_name_input: workflowName,
        user_uuid: user.id,
      })

      if (error) throw error

      return { data: data as WorkflowVersionHistoryItem[], error: null }
    } catch (error) {
      console.error('Error getting version history:', error)
      return { data: [], error: error as Error }
    }
  },
}

// ============================================================================
// WORKFLOW EXECUTION SERVICE
// ============================================================================

export const workflowExecutionService = {
  /**
   * Start a new execution
   */
  async startExecution(
    workflowId: string
  ): Promise<{ data: WorkflowExecution | null; error: Error | null }> {
    try {
      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('User not authenticated')

      // Get workflow for snapshot
      const { data: workflow, error: workflowError } = await workflowSessionService.getWorkflow(workflowId)
      if (workflowError || !workflow) throw new Error('Workflow not found')

      const insertData = toExecutionInsert({
        workflowId,
        userId: user.id,
        status: 'running',
        workflowSnapshot: {
          nodes: workflow.nodes,
          edges: workflow.edges,
          version: workflow.version,
        },
      })

      const { data, error } = await supabase
        .from('workflow_executions')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error

      const execution = data ? parseExecution(data as WorkflowExecutionRow) : null

      return { data: execution, error: null }
    } catch (error) {
      console.error('Error starting execution:', error)
      return { data: null, error: error as Error }
    }
  },

  /**
   * Complete an execution
   */
  async completeExecution(
    executionId: string,
    result: {
      status: 'completed' | 'failed' | 'cancelled'
      nodesExecuted: number
      outputs?: Record<string, any>
      errors?: any[]
      errorMessage?: string
    }
  ): Promise<{ error: Error | null }> {
    try {
      const updateData: Partial<WorkflowExecutionUpdate> = {
        status: result.status,
        nodes_executed: result.nodesExecuted,
        execution_completed_at: new Date().toISOString(),
      }

      if (result.outputs) updateData.outputs = result.outputs
      if (result.errors) updateData.errors = result.errors
      if (result.errorMessage) updateData.error_message = result.errorMessage

      const { error } = await supabase
        .from('workflow_executions')
        .update(updateData)
        .eq('id', executionId)

      if (error) throw error

      return { error: null }
    } catch (error) {
      console.error('Error completing execution:', error)
      return { error: error as Error }
    }
  },

  /**
   * List executions for a workflow
   */
  async listExecutions(
    filters: WorkflowExecutionFilters = {}
  ): Promise<{ data: WorkflowExecution[]; error: Error | null }> {
    try {
      let query = supabase.from('workflow_executions').select('*')

      // Apply filters
      if (filters.workflowId) {
        query = query.eq('workflow_id', filters.workflowId)
      }
      if (filters.status) {
        query = query.eq('status', filters.status)
      }
      if (filters.startDate) {
        query = query.gte('execution_started_at', filters.startDate.toISOString())
      }
      if (filters.endDate) {
        query = query.lte('execution_started_at', filters.endDate.toISOString())
      }

      // Apply ordering
      const orderBy = filters.orderBy ?? 'execution_started_at'
      const orderDirection = filters.orderDirection ?? 'desc'
      query = query.order(orderBy, { ascending: orderDirection === 'asc' })

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit)
      }
      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit ?? 20) - 1)
      }

      const { data, error } = await query

      if (error) throw error

      const executions = (data as WorkflowExecutionRow[]).map(parseExecution)

      return { data: executions, error: null }
    } catch (error) {
      console.error('Error listing executions:', error)
      return { data: [], error: error as Error }
    }
  },

  /**
   * Get execution statistics for a workflow
   */
  async getExecutionStats(
    workflowId: string
  ): Promise<{ data: WorkflowExecutionStats | null; error: Error | null }> {
    try {
      const { data, error } = await supabase.rpc('get_workflow_execution_stats', {
        workflow_uuid: workflowId,
      })

      if (error) throw error

      return { data: data as WorkflowExecutionStats, error: null }
    } catch (error) {
      console.error('Error getting execution stats:', error)
      return { data: null, error: error as Error }
    }
  },
}

// ============================================================================
// EXPORTS
// ============================================================================

const services = {
  workflow: workflowSessionService,
  execution: workflowExecutionService,
}

export default services
