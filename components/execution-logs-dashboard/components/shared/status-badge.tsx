import { Badge } from "@/components/ui/badge"
import { CheckCircle, Clock, XCircle, Ban } from "lucide-react"

interface StatusBadgeProps {
  status: "success" | "failed" | "pending" | "cancelled"
  showIcon?: boolean
  showLabel?: boolean
  className?: string
}

export const StatusBadge = ({ status, showIcon = true, showLabel = true, className = "" }: StatusBadgeProps) => {
  const config = {
    success: {
      icon: CheckCircle,
      variant: "default" as const,
      label: "Success",
    },
    failed: {
      icon: XCircle,
      variant: "destructive" as const,
      label: "Failed",
    },
    pending: {
      icon: Clock,
      variant: "secondary" as const,
      label: "Pending",
    },
    cancelled: {
      icon: Ban,
      variant: "outline" as const,
      label: "Cancelled",
    },
  }

  const { icon: Icon, variant, label } = config[status]

  return (
    <Badge variant={variant} className={className}>
      {showIcon && <Icon className="w-3 h-3 mr-1" />}
      {showLabel && label}
    </Badge>
  )
}
