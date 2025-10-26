/**
 * PENDING DECISIONS BADGE COMPONENT
 *
 * Task Group 15: Approval Workflow and Decision History
 * Subtask 15.6: Build pending-decisions-badge.tsx component
 *
 * This component displays:
 * - Red badge on orchestrator node showing pending count
 * - Click badge to open pending decisions panel
 * - Real-time update when decisions approved/rejected
 * - Uses TanStack Query for polling
 */

'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { AlertCircle, Clock, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import { ApprovalModal } from './approval-modal'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PendingDecisionsBadgeProps {
  workflowId: string
  className?: string
}

interface PendingDecision {
  id: string
  market_id: string
  decision: string
  direction: 'YES' | 'NO'
  recommended_size: number
  risk_score: number
  ai_reasoning: string
  created_at: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PendingDecisionsBadge({ workflowId, className }: PendingDecisionsBadgeProps) {
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  // Fetch pending decisions with polling
  const {
    data: pendingData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['pending-decisions', workflowId],
    queryFn: async () => {
      const params = new URLSearchParams({
        workflow_id: workflowId,
        status: 'pending',
        limit: '10',
      })

      const response = await fetch(`/api/orchestrator/decisions?${params}`)
      if (!response.ok) {
        throw new Error('Failed to fetch pending decisions')
      }
      return response.json()
    },
    refetchInterval: 10000, // Poll every 10 seconds
  })

  const pendingDecisions = pendingData?.decisions || []
  const count = pendingDecisions.length

  // Handle decision click
  const handleDecisionClick = (decisionId: string) => {
    setSelectedDecisionId(decisionId)
    setModalOpen(true)
    setPopoverOpen(false)
  }

  // Parse market question from reasoning
  const getMarketQuestion = (reasoning: string): string => {
    const match = reasoning.match(/Market: (.+?)\. /)
    if (match) {
      return match[1].length > 60 ? match[1].substring(0, 60) + '...' : match[1]
    }
    return 'Market Question'
  }

  // Get risk badge color
  const getRiskColor = (score: number) => {
    if (score <= 3) return 'bg-green-500'
    if (score <= 6) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  if (count === 0) {
    return null // Don't show badge if no pending decisions
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Badge
            variant="destructive"
            className={`cursor-pointer gap-1 ${className}`}
          >
            <AlertCircle className="h-3 w-3" />
            {count} Pending
          </Badge>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="end">
          <div className="border-b p-4">
            <h3 className="font-semibold">Pending Approvals</h3>
            <p className="text-sm text-muted-foreground">
              {count} trade{count !== 1 ? 's' : ''} waiting for approval
            </p>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {isLoading && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            )}
            {!isLoading && pendingDecisions.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No pending decisions
              </div>
            )}
            {!isLoading &&
              pendingDecisions.map((decision: PendingDecision) => (
                <div
                  key={decision.id}
                  className="cursor-pointer border-b p-4 hover:bg-muted/50"
                  onClick={() => handleDecisionClick(decision.id)}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {getMarketQuestion(decision.ai_reasoning)}
                    </p>
                    <Badge className={getRiskColor(decision.risk_score)} className="shrink-0">
                      {decision.risk_score}/10
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={decision.direction === 'YES' ? 'default' : 'secondary'}>
                        {decision.direction}
                      </Badge>
                      <span className="font-mono text-sm font-medium">
                        ${decision.recommended_size.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(decision.created_at), 'HH:mm')}
                    </div>
                  </div>
                </div>
              ))}
          </div>
          <div className="border-t p-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setPopoverOpen(false)}
            >
              Close
            </Button>
          </div>
        </PopoverContent>
      </Popover>

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
    </>
  )
}
