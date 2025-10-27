/**
 * Coverage Badge Component
 *
 * Displays wallet coverage_pct with color-coded indicator.
 * Governance: Never show realized P&L without coverage_pct.
 */

import { Badge } from '@/components/ui/badge'
import { Shield, ShieldAlert } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface CoverageBadgeProps {
  coveragePct: number
  showIcon?: boolean
  variant?: 'default' | 'minimal'
}

export function CoverageBadge({
  coveragePct,
  showIcon = true,
  variant = 'default',
}: CoverageBadgeProps) {
  // Color coding based on coverage level
  const getColorClass = () => {
    if (coveragePct >= 20) return 'bg-green-500 hover:bg-green-600 text-white'
    if (coveragePct >= 10) return 'bg-blue-500 hover:bg-blue-600 text-white'
    if (coveragePct >= 5) return 'bg-yellow-500 hover:bg-yellow-600 text-black'
    return 'bg-orange-500 hover:bg-orange-600 text-white'
  }

  const getGrade = () => {
    if (coveragePct >= 20) return 'Excellent'
    if (coveragePct >= 10) return 'Good'
    if (coveragePct >= 5) return 'Fair'
    return 'Adequate'
  }

  if (variant === 'minimal') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground">
              {coveragePct.toFixed(1)}% cov
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              Coverage: {coveragePct.toFixed(2)}%<br />
              {getGrade()} data quality
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={getColorClass()}>
            {showIcon && <Shield className="h-3 w-3 mr-1" />}
            {coveragePct.toFixed(1)}% coverage
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            <p className="font-semibold">{getGrade()} Coverage</p>
            <p>
              This wallet has {coveragePct.toFixed(2)}% of their resolved markets covered by our audited P&L data.
            </p>
            <p className="text-muted-foreground mt-1">
              All signal wallets have ≥2% coverage.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Warning badge for wallets with missing coverage data
 * (should be hidden instead, but this is for edge cases)
 */
export function MissingCoverageBadge() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive">
            <ShieldAlert className="h-3 w-3 mr-1" />
            No Coverage Data
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            This wallet is not in the audited signal set.<br />
            P&L data may be incomplete or unavailable.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
