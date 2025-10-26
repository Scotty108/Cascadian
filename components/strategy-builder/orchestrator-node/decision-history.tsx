/**
 * DECISION HISTORY COMPONENT
 *
 * Task Group 15: Approval Workflow and Decision History
 * Subtask 15.4: Build decision-history.tsx component
 *
 * This component displays a table of past orchestrator decisions with:
 * - Columns: Date, Market, Decision, Size, Risk Score, Outcome
 * - Filters: status, date range
 * - Pagination: 20 decisions per page
 * - Click row to see full details
 */

'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Loader2, ChevronLeft, ChevronRight, Filter, CheckCircle, XCircle, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { ApprovalModal } from './approval-modal'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface DecisionHistoryProps {
  workflowId?: string
  limit?: number
}

interface OrchestratorDecision {
  id: string
  execution_id: string
  workflow_id: string
  node_id: string
  market_id: string
  decision: 'GO' | 'NO_GO' | 'REDUCE' | 'CLOSE' | 'FLIP' | 'HOLD'
  direction: 'YES' | 'NO'
  recommended_size: number
  risk_score: number
  ai_reasoning: string
  ai_confidence: number
  status: 'pending' | 'approved' | 'rejected' | 'executed'
  user_override: boolean
  final_size?: number
  created_at: string
  executed_at?: string
  outcome?: 'win' | 'loss' | 'pending'
  pnl?: number
}

// ============================================================================
// COMPONENT
// ============================================================================

export function DecisionHistory({ workflowId, limit = 20 }: DecisionHistoryProps) {
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  // Fetch decisions
  const {
    data: decisionsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['orchestrator-decisions', workflowId, statusFilter, dateFilter, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString(),
      })

      if (workflowId) {
        params.append('workflow_id', workflowId)
      }

      if (statusFilter && statusFilter !== 'all') {
        params.append('status', statusFilter)
      }

      if (dateFilter) {
        params.append('created_after', dateFilter)
      }

      const response = await fetch(`/api/orchestrator/decisions?${params}`)
      if (!response.ok) {
        throw new Error('Failed to fetch decisions')
      }
      return response.json()
    },
  })

  const decisions = decisionsData?.decisions || []
  const total = decisionsData?.total || 0

  // Calculate pagination
  const totalPages = Math.ceil(total / limit)
  const hasNextPage = page < totalPages - 1
  const hasPrevPage = page > 0

  // Handle row click
  const handleRowClick = (decision: OrchestratorDecision) => {
    if (decision.status === 'pending') {
      setSelectedDecisionId(decision.id)
      setModalOpen(true)
    }
  }

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        )
      case 'approved':
        return (
          <Badge variant="default" className="gap-1 bg-blue-500">
            <CheckCircle className="h-3 w-3" />
            Approved
          </Badge>
        )
      case 'executed':
        return (
          <Badge variant="default" className="gap-1 bg-green-500">
            <CheckCircle className="h-3 w-3" />
            Executed
          </Badge>
        )
      case 'rejected':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  // Get decision badge
  const getDecisionBadge = (decision: string) => {
    const color =
      decision === 'GO' ? 'bg-green-500' :
      decision === 'NO_GO' ? 'bg-red-500' :
      decision === 'HOLD' ? 'bg-gray-500' :
      'bg-blue-500'

    return <Badge className={color}>{decision}</Badge>
  }

  // Get risk badge
  const getRiskBadge = (score: number) => {
    const color =
      score <= 3 ? 'bg-green-500' :
      score <= 6 ? 'bg-yellow-500' :
      'bg-red-500'

    return <Badge className={color}>{score}/10</Badge>
  }

  // Parse market question from reasoning
  const getMarketQuestion = (reasoning: string): string => {
    const match = reasoning.match(/Market: (.+?)\. /)
    if (match) {
      return match[1].length > 50 ? match[1].substring(0, 50) + '...' : match[1]
    }
    return 'Market Question'
  }

  return (
    <div className="space-y-4">
      {/* Header and Filters */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Decision History</h2>
          <p className="text-sm text-muted-foreground">
            View and manage orchestrator decisions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="executed">Executed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-[180px]"
            placeholder="Filter by date"
          />
        </div>
      </div>

      {/* Summary Stats */}
      {decisionsData?.summary && (
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Decisions</p>
            <p className="text-2xl font-bold">{decisionsData.summary.total}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Approval Rate</p>
            <p className="text-2xl font-bold">
              {decisionsData.summary.total > 0
                ? Math.round((decisionsData.summary.approved / decisionsData.summary.total) * 100)
                : 0}%
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Avg Position Size</p>
            <p className="text-2xl font-bold">
              ${decisionsData.summary.avg_position_size?.toFixed(0) || 0}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Pending</p>
            <p className="text-2xl font-bold text-yellow-500">
              {decisionsData.summary.pending || 0}
            </p>
          </div>
        </div>
      )}

      {/* Decision Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Market</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}

            {error && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-destructive">
                  Failed to load decisions
                </TableCell>
              </TableRow>
            )}

            {!isLoading && !error && decisions.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No decisions found
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              !error &&
              decisions.map((decision: OrchestratorDecision) => (
                <TableRow
                  key={decision.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(decision)}
                >
                  <TableCell className="font-mono text-sm">
                    {format(new Date(decision.created_at), 'MMM d, HH:mm')}
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {getMarketQuestion(decision.ai_reasoning)}
                  </TableCell>
                  <TableCell>{getDecisionBadge(decision.decision)}</TableCell>
                  <TableCell>
                    <Badge variant={decision.direction === 'YES' ? 'default' : 'secondary'}>
                      {decision.direction}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">
                    ${decision.final_size?.toFixed(0) || decision.recommended_size.toFixed(0)}
                  </TableCell>
                  <TableCell>{getRiskBadge(decision.risk_score)}</TableCell>
                  <TableCell>{getStatusBadge(decision.status)}</TableCell>
                  <TableCell>
                    {decision.outcome === 'win' && (
                      <span className="font-mono text-sm text-green-500">
                        +${decision.pnl?.toFixed(2)}
                      </span>
                    )}
                    {decision.outcome === 'loss' && (
                      <span className="font-mono text-sm text-red-500">
                        -${Math.abs(decision.pnl || 0).toFixed(2)}
                      </span>
                    )}
                    {(!decision.outcome || decision.outcome === 'pending') && (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total} decisions
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={!hasPrevPage}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={!hasNextPage}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Approval Modal */}
      <ApprovalModal
        decisionId={selectedDecisionId}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setSelectedDecisionId(null)
        }}
        onApproved={() => {
          refetch()
        }}
        onRejected={() => {
          refetch()
        }}
      />
    </div>
  )
}
