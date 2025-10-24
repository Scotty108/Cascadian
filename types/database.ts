/**
 * DATABASE TYPE DEFINITIONS
 *
 * TypeScript types for Supabase database schema.
 * Auto-generated types should be replaced with `supabase gen types typescript`.
 *
 * This file provides manual types for workflow_sessions, workflow_executions,
 * and notifications tables until auto-generation is set up.
 */

import type { WorkflowNode, WorkflowEdge, WorkflowTrigger, ExecutionError } from './workflow'

// ============================================================================
// NOTIFICATIONS TABLE
// ============================================================================

/**
 * Notification type enum
 */
export type NotificationType =
  | 'whale_activity'
  | 'market_alert'
  | 'insider_alert'
  | 'strategy_update'
  | 'system'
  | 'security'
  | 'account'

/**
 * Notification priority enum
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Database row type for notifications table
 */
export interface NotificationRow {
  // Primary Key
  id: number // BIGSERIAL

  // User Association
  user_id: string | null // UUID, nullable for anonymous users

  // Classification
  type: NotificationType

  // Content
  title: string
  message: string
  link: string | null // Optional URL to navigate to

  // Status
  is_read: boolean
  is_archived: boolean

  // Priority
  priority: NotificationPriority

  // Metadata
  metadata: Record<string, any> // JSONB

  // Timestamps
  created_at: string // TIMESTAMPTZ
  read_at: string | null // TIMESTAMPTZ
  archived_at: string | null // TIMESTAMPTZ
}

/**
 * Insert type for notifications
 */
export interface NotificationInsert {
  user_id?: string | null
  type: NotificationType
  title: string
  message: string
  link?: string | null
  is_read?: boolean
  is_archived?: boolean
  priority?: NotificationPriority
  metadata?: Record<string, any>
}

/**
 * Update type for notifications
 */
export interface NotificationUpdate {
  is_read?: boolean
  is_archived?: boolean
  read_at?: string | null
  archived_at?: string | null
}

/**
 * Application-level notification type (parsed from database)
 */
export interface Notification {
  id: number
  userId?: string
  type: NotificationType
  title: string
  message: string
  link?: string
  isRead: boolean
  isArchived: boolean
  priority: NotificationPriority
  metadata: Record<string, any>
  createdAt: Date
  readAt?: Date
  archivedAt?: Date
}

// ============================================================================
// WORKFLOW SESSIONS TABLE
// ============================================================================

/**
 * Database row type for workflow_sessions table
 */
export interface WorkflowSessionRow {
  // Primary Key
  id: string // UUID

  // User Association
  user_id: string // UUID

  // Workflow Identity
  name: string
  description: string | null

  // Workflow Definition (stored as JSONB)
  nodes: WorkflowNode[] // JSONB array
  edges: WorkflowEdge[] // JSONB array

  // Workflow Configuration
  trigger: WorkflowTrigger | null // JSONB
  variables: Record<string, any> // JSONB object

  // Version Management
  version: number
  is_current_version: boolean
  parent_workflow_id: string | null // UUID

  // Metadata & Organization
  tags: string[] // TEXT[]
  is_template: boolean
  is_favorite: boolean
  folder: string | null

  // Execution Metadata
  last_executed_at: string | null // TIMESTAMPTZ
  execution_count: number

  // Status
  status: 'draft' | 'active' | 'paused' | 'archived'

  // Timestamps
  created_at: string // TIMESTAMPTZ
  updated_at: string // TIMESTAMPTZ
}

/**
 * Insert type for workflow_sessions (fields that can be provided on INSERT)
 */
export interface WorkflowSessionInsert {
  id?: string // Optional, auto-generated if not provided
  user_id: string
  name: string
  description?: string | null
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
  trigger?: WorkflowTrigger | null
  variables?: Record<string, any>
  version?: number
  is_current_version?: boolean
  parent_workflow_id?: string | null
  tags?: string[]
  is_template?: boolean
  is_favorite?: boolean
  folder?: string | null
  status?: 'draft' | 'active' | 'paused' | 'archived'
}

/**
 * Update type for workflow_sessions (all fields optional)
 */
export interface WorkflowSessionUpdate {
  name?: string
  description?: string | null
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
  trigger?: WorkflowTrigger | null
  variables?: Record<string, any>
  version?: number
  is_current_version?: boolean
  parent_workflow_id?: string | null
  tags?: string[]
  is_template?: boolean
  is_favorite?: boolean
  folder?: string | null
  last_executed_at?: string | null
  execution_count?: number
  status?: 'draft' | 'active' | 'paused' | 'archived'
}

/**
 * Application-level workflow type (parsed from database)
 */
export interface WorkflowSession {
  id: string
  userId: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  trigger?: WorkflowTrigger
  variables: Record<string, any>
  version: number
  isCurrentVersion: boolean
  parentWorkflowId?: string
  tags: string[]
  isTemplate: boolean
  isFavorite: boolean
  folder?: string
  lastExecutedAt?: Date
  executionCount: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// WORKFLOW EXECUTIONS TABLE
// ============================================================================

/**
 * Database row type for workflow_executions table
 */
export interface WorkflowExecutionRow {
  // Primary Key
  id: string // UUID

  // Workflow Reference
  workflow_id: string // UUID
  user_id: string // UUID

  // Execution Metadata
  execution_started_at: string // TIMESTAMPTZ
  execution_completed_at: string | null // TIMESTAMPTZ
  duration_ms: number | null

  // Execution Results
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  nodes_executed: number

  // Execution Outputs
  outputs: Record<string, any> // JSONB object
  errors: ExecutionError[] | null // JSONB array
  error_message: string | null

  // Workflow Snapshot
  workflow_snapshot: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
    version: number
  } | null // JSONB

  // Timestamps
  created_at: string // TIMESTAMPTZ
}

/**
 * Insert type for workflow_executions
 */
export interface WorkflowExecutionInsert {
  id?: string
  workflow_id: string
  user_id: string
  execution_started_at?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  nodes_executed?: number
  outputs?: Record<string, any>
  errors?: ExecutionError[]
  error_message?: string
  workflow_snapshot?: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
    version: number
  }
}

/**
 * Update type for workflow_executions
 */
export interface WorkflowExecutionUpdate {
  execution_completed_at?: string
  duration_ms?: number
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  nodes_executed?: number
  outputs?: Record<string, any>
  errors?: ExecutionError[]
  error_message?: string
}

/**
 * Application-level execution type (parsed from database)
 */
export interface WorkflowExecution {
  id: string
  workflowId: string
  userId: string
  executionStartedAt: Date
  executionCompletedAt?: Date
  durationMs?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  nodesExecuted: number
  outputs: Record<string, any>
  errors?: ExecutionError[]
  errorMessage?: string
  workflowSnapshot?: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
    version: number
  }
  createdAt: Date
}

// ============================================================================
// QUERY FILTER TYPES
// ============================================================================

/**
 * Filter options for querying workflows
 */
export interface WorkflowSessionFilters {
  userId?: string
  status?: 'draft' | 'active' | 'paused' | 'archived'
  isTemplate?: boolean
  isFavorite?: boolean
  folder?: string
  tags?: string[] // Match any of these tags
  searchQuery?: string // Full-text search on name/description
  isCurrentVersion?: boolean
  limit?: number
  offset?: number
  orderBy?: 'updated_at' | 'created_at' | 'name' | 'execution_count'
  orderDirection?: 'asc' | 'desc'
}

/**
 * Filter options for querying workflow executions
 */
export interface WorkflowExecutionFilters {
  workflowId?: string
  userId?: string
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
  startDate?: Date
  endDate?: Date
  limit?: number
  offset?: number
  orderBy?: 'execution_started_at' | 'duration_ms' | 'nodes_executed'
  orderDirection?: 'asc' | 'desc'
}

// ============================================================================
// HELPER FUNCTION RETURN TYPES
// ============================================================================

/**
 * Return type for get_workflow_version_history()
 */
export interface WorkflowVersionHistoryItem {
  id: string
  version: number
  created_at: string
  is_current_version: boolean
}

/**
 * Return type for get_workflow_execution_stats()
 */
export interface WorkflowExecutionStats {
  total_executions: number
  successful_executions: number
  failed_executions: number
  avg_duration_ms: number
  last_execution_at: string | null
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Database tables union type
 */
export type DatabaseTable = 'workflow_sessions' | 'workflow_executions' | 'notifications'

/**
 * Type-safe database operations
 */
export interface DatabaseOperations {
  workflow_sessions: {
    Row: WorkflowSessionRow
    Insert: WorkflowSessionInsert
    Update: WorkflowSessionUpdate
  }
  workflow_executions: {
    Row: WorkflowExecutionRow
    Insert: WorkflowExecutionInsert
    Update: WorkflowExecutionUpdate
  }
  notifications: {
    Row: NotificationRow
    Insert: NotificationInsert
    Update: NotificationUpdate
  }
}

// ============================================================================
// PARSER/MAPPER UTILITIES
// ============================================================================

/**
 * Parse database row to application-level WorkflowSession
 */
export function parseWorkflowSession(row: WorkflowSessionRow): WorkflowSession {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    nodes: row.nodes,
    edges: row.edges,
    trigger: row.trigger ?? undefined,
    variables: row.variables,
    version: row.version,
    isCurrentVersion: row.is_current_version,
    parentWorkflowId: row.parent_workflow_id ?? undefined,
    tags: row.tags,
    isTemplate: row.is_template,
    isFavorite: row.is_favorite,
    folder: row.folder ?? undefined,
    lastExecutedAt: row.last_executed_at ? new Date(row.last_executed_at) : undefined,
    executionCount: row.execution_count,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Parse database row to application-level WorkflowExecution
 */
export function parseWorkflowExecution(row: WorkflowExecutionRow): WorkflowExecution {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    executionStartedAt: new Date(row.execution_started_at),
    executionCompletedAt: row.execution_completed_at
      ? new Date(row.execution_completed_at)
      : undefined,
    durationMs: row.duration_ms ?? undefined,
    status: row.status,
    nodesExecuted: row.nodes_executed,
    outputs: row.outputs,
    errors: row.errors ?? undefined,
    errorMessage: row.error_message ?? undefined,
    workflowSnapshot: row.workflow_snapshot ?? undefined,
    createdAt: new Date(row.created_at),
  }
}

/**
 * Convert application WorkflowSession to database insert
 */
export function toWorkflowSessionInsert(
  workflow: Partial<WorkflowSession> & { userId: string; name: string }
): WorkflowSessionInsert {
  return {
    user_id: workflow.userId,
    name: workflow.name,
    description: workflow.description ?? null,
    nodes: workflow.nodes ?? [],
    edges: workflow.edges ?? [],
    trigger: workflow.trigger ?? null,
    variables: workflow.variables ?? {},
    version: workflow.version ?? 1,
    is_current_version: workflow.isCurrentVersion ?? true,
    parent_workflow_id: workflow.parentWorkflowId ?? null,
    tags: workflow.tags ?? [],
    is_template: workflow.isTemplate ?? false,
    is_favorite: workflow.isFavorite ?? false,
    folder: workflow.folder ?? null,
    status: workflow.status ?? 'draft',
  }
}

/**
 * Convert application WorkflowExecution to database insert
 */
export function toWorkflowExecutionInsert(
  execution: Partial<WorkflowExecution> & { workflowId: string; userId: string }
): WorkflowExecutionInsert {
  return {
    workflow_id: execution.workflowId,
    user_id: execution.userId,
    execution_started_at: execution.executionStartedAt?.toISOString(),
    status: execution.status ?? 'running',
    nodes_executed: execution.nodesExecuted ?? 0,
    outputs: execution.outputs ?? {},
    errors: execution.errors,
    error_message: execution.errorMessage,
    workflow_snapshot: execution.workflowSnapshot,
  }
}

/**
 * Parse database row to application-level Notification
 */
export function parseNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link ?? undefined,
    isRead: row.is_read,
    isArchived: row.is_archived,
    priority: row.priority,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    readAt: row.read_at ? new Date(row.read_at) : undefined,
    archivedAt: row.archived_at ? new Date(row.archived_at) : undefined,
  }
}

/**
 * Convert application Notification to database insert
 */
export function toNotificationInsert(
  notification: Partial<Notification> & { type: NotificationType; title: string; message: string }
): NotificationInsert {
  return {
    user_id: notification.userId ?? null,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    link: notification.link ?? null,
    is_read: notification.isRead ?? false,
    is_archived: notification.isArchived ?? false,
    priority: notification.priority ?? 'normal',
    metadata: notification.metadata ?? {},
  }
}

/**
 * Filter options for querying notifications
 */
export interface NotificationFilters {
  userId?: string | null
  type?: NotificationType
  isRead?: boolean
  isArchived?: boolean
  priority?: NotificationPriority
  limit?: number
  offset?: number
  orderBy?: 'created_at' | 'read_at' | 'priority'
  orderDirection?: 'asc' | 'desc'
}
