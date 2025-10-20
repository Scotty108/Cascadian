import { ArrowUpRight, ArrowDownLeft, RefreshCw, Layers, Download, Upload } from "lucide-react"
import { cn } from "@/lib/utils"

interface TransactionIconProps {
  type: string
  className?: string
}

export function TransactionIcon({ type, className }: TransactionIconProps) {
  const getIcon = () => {
    switch (type) {
      case "send":
        return <ArrowUpRight className="h-4 w-4" />
      case "receive":
        return <ArrowDownLeft className="h-4 w-4" />
      case "swap":
        return <RefreshCw className="h-4 w-4" />
      case "stake":
        return <Layers className="h-4 w-4" />
      case "nft-buy":
        return <Download className="h-4 w-4" />
      case "nft-sell":
        return <Upload className="h-4 w-4" />
      default:
        return <ArrowUpRight className="h-4 w-4" />
    }
  }

  const getColorClass = () => {
    switch (type) {
      case "receive":
        return "bg-green-100 text-green-600"
      case "send":
        return "bg-red-100 text-red-600"
      default:
        return "bg-blue-100 text-blue-600"
    }
  }

  return (
    <div className={cn("flex h-8 w-8 items-center justify-center rounded-full", getColorClass(), className)}>
      {getIcon()}
    </div>
  )
}
