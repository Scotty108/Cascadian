/**
 * APPROVAL MODAL COMPONENT
 *
 * Task Group 15: Approval Workflow and Decision History
 * Subtask 15.3: Build approval-modal.tsx component
 *
 * This modal displays AI-recommended trades for user approval.
 * It shows:
 * - Market question and current odds
 * - AI reasoning and risk score
 * - Recommended position size with adjustment slider
 * - Current portfolio state
 * - Approve/Reject/Adjust actions
 */

'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Loader2, TrendingUp, TrendingDown, AlertCircle, CheckCircle } from 'lucide-react'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ApprovalModalProps {
  decisionId: string | null
  open: boolean
  onClose: () => void
  onApproved?: () => void
  onRejected?: () => void
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
  portfolio_snapshot: {
    bankroll_total_equity_usd: number
    bankroll_free_cash_usd: number
    deployed_capital: number
    open_positions: number
  }
  status: 'pending' | 'approved' | 'rejected' | 'executed'
  user_override: boolean
  final_size?: number
  created_at: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ApprovalModal({
  decisionId,
  open,
  onClose,
  onApproved,
  onRejected,
}: ApprovalModalProps) {
  const queryClient = useQueryClient()
  const [adjustedSize, setAdjustedSize] = useState<number>(0)
  const [sliderValue, setSliderValue] = useState<number[]>([0])

  // Fetch decision details
  const {
    data: decision,
    isLoading,
    error,
  } = useQuery<OrchestratorDecision>({
    queryKey: ['orchestrator-decision', decisionId],
    queryFn: async () => {
      if (!decisionId) throw new Error('No decision ID')
      const response = await fetch(`/api/orchestrator/decisions/${decisionId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch decision')
      }
      const data = await response.json()
      return data.decision
    },
    enabled: !!decisionId && open,
  })

  // Initialize adjusted size when decision loads
  useEffect(() => {
    if (decision) {
      setAdjustedSize(decision.recommended_size)
      setSliderValue([decision.recommended_size])
    }
  }, [decision])

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (finalSize: number) => {
      const response = await fetch(`/api/orchestrator/decisions/${decisionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_size: finalSize }),
      })
      if (!response.ok) {
        throw new Error('Failed to approve decision')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-decisions'] })
      queryClient.invalidateQueries({ queryKey: ['orchestrator-decision', decisionId] })
      onApproved?.()
      onClose()
    },
  })

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      const response = await fetch(`/api/orchestrator/decisions/${decisionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!response.ok) {
        throw new Error('Failed to reject decision')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-decisions'] })
      queryClient.invalidateQueries({ queryKey: ['orchestrator-decision', decisionId] })
      onRejected?.()
      onClose()
    },
  })

  // Handle slider change
  const handleSliderChange = (value: number[]) => {
    setSliderValue(value)
    setAdjustedSize(value[0])
  }

  // Handle approve
  const handleApprove = () => {
    approveMutation.mutate(adjustedSize)
  }

  // Handle reject
  const handleReject = () => {
    rejectMutation.mutate('User rejected recommendation')
  }

  // Calculate min and max bet sizes
  const minBet = decision ? Math.max(10, decision.recommended_size * 0.25) : 10
  const maxBet = decision ? Math.min(decision.portfolio_snapshot.bankroll_free_cash_usd, decision.recommended_size * 2) : 1000

  // Calculate risk badge color
  const getRiskColor = (score: number) => {
    if (score <= 3) return 'bg-green-500'
    if (score <= 6) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  // Parse market question from reasoning
  const getMarketQuestion = (reasoning: string) => {
    const match = reasoning.match(/Market: (.+?)\. /)
    return match ? match[1] : 'Market Question'
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Trade Approval Required
          </DialogTitle>
          <DialogDescription>
            Review and approve this AI-recommended trade
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>Failed to load decision details</p>
          </div>
        )}

        {decision && (
          <div className="space-y-6">
            {/* Market Information */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-2 font-semibold">Market</h3>
              <p className="text-sm text-muted-foreground">{getMarketQuestion(decision.ai_reasoning)}</p>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Badge variant={decision.direction === 'YES' ? 'default' : 'secondary'}>
                    {decision.direction}
                  </Badge>
                  <span className="text-sm text-muted-foreground">Direction</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={getRiskColor(decision.risk_score)}>
                    Risk: {decision.risk_score}/10
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    Confidence: {Math.round(decision.ai_confidence * 100)}%
                  </span>
                </div>
              </div>
            </div>

            {/* AI Reasoning */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-2 font-semibold">AI Analysis</h3>
              <p className="text-sm text-muted-foreground">{decision.ai_reasoning}</p>
            </div>

            {/* Position Sizing */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-4 font-semibold">Position Size</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Recommended Size:</span>
                  <span className="font-mono font-semibold">
                    ${decision.recommended_size.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Adjusted Size:</span>
                  <span className="font-mono font-semibold text-primary">
                    ${adjustedSize.toFixed(2)}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>${minBet.toFixed(0)}</span>
                    <span>Adjust position size</span>
                    <span>${maxBet.toFixed(0)}</span>
                  </div>
                  <Slider
                    value={sliderValue}
                    onValueChange={handleSliderChange}
                    min={minBet}
                    max={maxBet}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            {/* Portfolio State */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-4 font-semibold">Current Portfolio</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Equity</p>
                  <p className="font-mono font-semibold">
                    ${decision.portfolio_snapshot.bankroll_total_equity_usd.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Available Cash</p>
                  <p className="font-mono font-semibold">
                    ${decision.portfolio_snapshot.bankroll_free_cash_usd.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Deployed Capital</p>
                  <p className="font-mono font-semibold">
                    ${decision.portfolio_snapshot.deployed_capital.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Open Positions</p>
                  <p className="font-mono font-semibold">
                    {decision.portfolio_snapshot.open_positions}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={rejectMutation.isPending || approveMutation.isPending}
          >
            {rejectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reject
          </Button>
          <Button
            onClick={handleApprove}
            disabled={rejectMutation.isPending || approveMutation.isPending}
          >
            {approveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <CheckCircle className="mr-2 h-4 w-4" />
            Approve ${adjustedSize.toFixed(0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
