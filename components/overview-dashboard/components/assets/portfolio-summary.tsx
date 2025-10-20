"use client"

import { formatCurrency, formatNumber } from "../../utils"

interface PortfolioSummaryProps {
  totalValue: number
}

export function PortfolioSummary({ totalValue }: PortfolioSummaryProps) {
  const btcPrice = 68245.32
  const btcValue = totalValue / btcPrice

  return (
    <div className="mb-4 p-4 bg-muted/50 rounded-lg">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Portfolio Value</p>
          <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">BTC Value</p>
          <p className="text-lg font-semibold">{formatNumber(btcValue)} BTC</p>
        </div>
      </div>
    </div>
  )
}
