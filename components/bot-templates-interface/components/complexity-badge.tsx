import { Badge } from "@/components/ui/badge"
import { getComplexityColor } from "../utils"
import type { BotComplexity } from "../types"

interface ComplexityBadgeProps {
  complexity: BotComplexity
  variant?: "default" | "outline" | "secondary"
}

export function ComplexityBadge({ complexity, variant = "secondary" }: ComplexityBadgeProps) {
  return (
    <Badge variant={variant} className={getComplexityColor(complexity)}>
      {complexity}
    </Badge>
  )
}
