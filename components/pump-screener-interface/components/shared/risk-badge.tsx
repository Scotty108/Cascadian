import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface RiskBadgeProps {
  risk: "low" | "medium" | "high" | "very high"
  className?: string
}

export function RiskBadge({ risk, className }: RiskBadgeProps) {
  const getRiskColor = (risk: string) => {
    switch (risk.toLowerCase()) {
      case "low":
        return "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30"
      case "medium":
        return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
      case "high":
        return "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30"
      case "very high":
        return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30"
      default:
        return "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30"
    }
  }

  return (
    <Badge variant="outline" className={cn(getRiskColor(risk), className)}>
      {risk.charAt(0).toUpperCase() + risk.slice(1)}
    </Badge>
  )
}
