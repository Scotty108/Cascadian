import { Badge } from "@/components/ui/badge"
import { AlertCircle, AlertTriangle, Info, Terminal } from "lucide-react"

interface LogLevelBadgeProps {
  level: "error" | "warning" | "info" | "debug"
  showIcon?: boolean
  showLabel?: boolean
  className?: string
}

export const LogLevelBadge = ({ level, showIcon = true, showLabel = true, className = "" }: LogLevelBadgeProps) => {
  const config = {
    error: {
      icon: AlertCircle,
      variant: "destructive" as const,
      label: "Error",
    },
    warning: {
      icon: AlertTriangle,
      variant: "secondary" as const,
      label: "Warning",
    },
    info: {
      icon: Info,
      variant: "secondary" as const,
      label: "Info",
    },
    debug: {
      icon: Terminal,
      variant: "outline" as const,
      label: "Debug",
    },
  }

  const { icon: Icon, variant, label } = config[level]

  return (
    <Badge variant={variant} className={className}>
      {showIcon && <Icon className="w-3 h-3 mr-1" />}
      {showLabel && label}
    </Badge>
  )
}
