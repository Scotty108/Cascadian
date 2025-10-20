import { Cpu, Repeat, LayoutDashboard, Layers, TrendingUp, DollarSign, BarChart3, Circle } from "lucide-react"

interface CategoryIconProps {
  category: string
  className?: string
}

export function CategoryIcon({ category, className = "h-3 w-3" }: CategoryIconProps) {
  const iconMap = {
    AI: Cpu,
    DCA: Repeat,
    Grid: LayoutDashboard,
    Arbitrage: Layers,
    Scalping: TrendingUp,
    DeFi: DollarSign,
    Technical: BarChart3,
  }

  const IconComponent = iconMap[category as keyof typeof iconMap] || Circle

  return <IconComponent className={className} />
}
