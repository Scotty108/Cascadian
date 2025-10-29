/**
 * ORCHESTRATOR DECISIONS SECTION
 *
 * Task Group 15: Approval Workflow and Decision History
 * Subtask 15.7: Add orchestrator decisions to strategy dashboard
 *
 * This component displays:
 * - Recent orchestrator decisions (5 most recent)
 * - Summary stats (total decisions, approval rate, avg position size)
 * - Link to full decision history
 */

'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, TrendingUp, CheckCircle, XCircle, Clock, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'

interface OrchestratorDecisionsSectionProps {
  workflowId: string
}

interface Decision {
  id: string
  market_id: string
  decision: 'GO' | 'NO_GO' | 'REDUCE' | 'CLOSE' | 'FLIP' | 'HOLD'
  direction: 'YES' | 'NO'
  recommended_size: number
  risk_score: number
  ai_reasoning: string
  status: 'pending' | 'approved' | 'rejected' | 'executed'
  created_at: string
}

interface DecisionsData {
  decisions: Decision[]
  summary?: {
    total: number
    approved: number
    pending: number
    avg_position_size: number
  }
}

export function OrchestratorDecisionsSection({ workflowId }: OrchestratorDecisionsSectionProps) {
  // Fetch recent decisions
  const { data, isLoading, error } = useQuery<DecisionsData>({
    queryKey: ['orchestrator-decisions-summary', workflowId],
    queryFn: async () => {
      const params = new URLSearchParams({
        workflow_id: workflowId,
        limit: '5',
      })
      const response = await fetch(`/api/orchestrator/decisions?${params}`)
      if (!response.ok) {
        throw new Error('Failed to fetch decisions')
      }
      return response.json()
    },
    refetchInterval: 180000, // Refresh every 3 minutes (reduced from 30s to save egress)
  })

  const decisions = data?.decisions || []
  const summary = data?.summary

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="outline" className="gap-1 text-xs">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        )
      case 'approved':
        return (
          <Badge variant="default" className="gap-1 bg-blue-500 text-xs">
            <CheckCircle className="h-3 w-3" />
            Approved
          </Badge>
        )
      case 'executed':
        return (
          <Badge variant="default" className="gap-1 bg-green-500 text-xs">
            <CheckCircle className="h-3 w-3" />
            Executed
          </Badge>
        )
      case 'rejected':
        return (
          <Badge variant="destructive" className="gap-1 text-xs">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        )
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>
    }
  }

  // Get decision badge
  const getDecisionBadge = (decision: string) => {
    const color =
      decision === 'GO' ? 'bg-green-500' :
      decision === 'NO_GO' ? 'bg-red-500' :
      decision === 'HOLD' ? 'bg-gray-500' :
      'bg-blue-500'

    return <Badge className={`${color} text-xs`}>{decision}</Badge>
  }

  // Parse market question from reasoning
  const getMarketQuestion = (reasoning: string): string => {
    const match = reasoning.match(/Market: (.+?)\. /)
    if (match) {
      return match[1].length > 60 ? match[1].substring(0, 60) + '...' : match[1]
    }
    return 'Market Question'
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Portfolio Orchestrator Decisions
          </CardTitle>
          <CardDescription>AI-powered position sizing decisions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Portfolio Orchestrator Decisions
          </CardTitle>
          <CardDescription>AI-powered position sizing decisions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Failed to load orchestrator decisions
          </div>
        </CardContent>
      </Card>
    )
  }

  if (decisions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Portfolio Orchestrator Decisions
          </CardTitle>
          <CardDescription>AI-powered position sizing decisions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No orchestrator decisions yet. Add an Orchestrator node to your strategy to enable AI-powered position sizing.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Portfolio Orchestrator Decisions
            </CardTitle>
            <CardDescription>AI-powered position sizing decisions</CardDescription>
          </div>
          <Link href={`/strategies/${workflowId}/decisions`}>
            <Button variant="outline" size="sm" className="gap-2">
              View All
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Total Decisions</p>
              <p className="text-2xl font-bold">{summary.total}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Approval Rate</p>
              <p className="text-2xl font-bold">
                {summary.total > 0
                  ? Math.round((summary.approved / summary.total) * 100)
                  : 0}%
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Avg Position</p>
              <p className="text-2xl font-bold">
                ${summary.avg_position_size?.toFixed(0) || 0}
              </p>
            </div>
          </div>
        )}

        {/* Recent Decisions */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Recent Decisions</h4>
          {decisions.map((decision) => (
            <div
              key={decision.id}
              className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {getMarketQuestion(decision.ai_reasoning)}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {getDecisionBadge(decision.decision)}
                  <Badge variant={decision.direction === 'YES' ? 'default' : 'secondary'} className="text-xs">
                    {decision.direction}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    ${decision.recommended_size.toFixed(0)}
                  </span>
                </div>
              </div>
              <div className="ml-4 flex flex-col items-end gap-1">
                {getStatusBadge(decision.status)}
                <span className="text-xs text-muted-foreground">
                  {format(new Date(decision.created_at), 'MMM d, HH:mm')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
