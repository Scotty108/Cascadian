import { CheckCircle2, Clock, X } from "lucide-react"

interface StatusIconProps {
  status: string
}

export function StatusIcon({ status }: StatusIconProps) {
  switch (status) {
    case "confirmed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case "pending":
      return <Clock className="h-4 w-4 text-yellow-500" />
    case "failed":
      return <X className="h-4 w-4 text-red-500" />
    default:
      return <Clock className="h-4 w-4 text-yellow-500" />
  }
}
