/**
 * Omega Badge Component
 *
 * Displays a wallet's Omega grade badge (S/A/B/C/D/F)
 */

import { Badge } from "@/components/ui/badge"
import { useWalletOmegaScore } from "@/hooks/use-wallet-omega-score"

interface OmegaBadgeProps {
  walletAddress: string
  size?: 'sm' | 'md'
  showLoading?: boolean
}

export function OmegaBadge({ walletAddress, size = 'sm', showLoading = false }: OmegaBadgeProps) {
  const { data: omegaScore, isLoading } = useWalletOmegaScore({ walletAddress })

  if (isLoading && showLoading) {
    return (
      <Badge variant="outline" className={`${size === 'sm' ? 'text-xs px-1.5 py-0' : 'text-sm px-2 py-0.5'} text-muted-foreground`}>
        ...
      </Badge>
    )
  }

  if (!omegaScore || !omegaScore.meets_minimum_trades) {
    return null
  }

  const gradeColors = {
    S: 'bg-purple-500 hover:bg-purple-600 text-white border-purple-500',
    A: 'bg-[#00E0AA] hover:bg-[#00E0AA]/90 text-black border-[#00E0AA]',
    B: 'bg-blue-500 hover:bg-blue-600 text-white border-blue-500',
    C: 'bg-yellow-500 hover:bg-yellow-600 text-black border-yellow-500',
    D: 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500',
    F: 'bg-red-500 hover:bg-red-600 text-white border-red-500',
  }

  const momentumEmoji = {
    improving: '📈',
    declining: '📉',
    stable: '➡️',
  }

  return (
    <Badge
      className={`${size === 'sm' ? 'text-xs px-1.5 py-0' : 'text-sm px-2 py-0.5'} font-bold border ${gradeColors[omegaScore.grade]}`}
      title={`Omega: ${omegaScore.omega_ratio.toFixed(2)} • ${momentumEmoji[omegaScore.momentum_direction]} ${omegaScore.momentum_direction}`}
    >
      {omegaScore.grade}
    </Badge>
  )
}
