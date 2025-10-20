import { Badge } from "@/components/ui/badge"
import { getRiskBadgeVariant, getTransactionBadgeVariant } from "../../utils"

interface StatusBadgeProps {
  type: "risk" | "transaction" | "status"
  value: string
  variant?: "default" | "secondary" | "destructive" | "outline"
}

export function StatusBadge({ type, value, variant }: StatusBadgeProps) {
  const getVariant = () => {
    if (variant) return variant

    switch (type) {
      case "risk":
        return getRiskBadgeVariant(value)
      case "transaction":
        return getTransactionBadgeVariant(value)
      default:
        return "default"
    }
  }

  return <Badge variant={getVariant()}>{value}</Badge>
}
