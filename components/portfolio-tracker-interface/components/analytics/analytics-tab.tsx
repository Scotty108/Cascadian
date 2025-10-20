import { RiskAssessment } from "./risk-assessment"
import { PortfolioMetrics } from "./portfolio-metrics"
import { OptimizationSuggestions } from "./optimization-suggestions"
import { CorrelationMatrix } from "./correlation-matrix"
import { TaxReporting } from "./tax-reporting"
import { riskMetrics, portfolioMetrics, optimizationSuggestions } from "../../data"

export function AnalyticsTab() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <RiskAssessment metrics={riskMetrics} />
        <PortfolioMetrics metrics={portfolioMetrics} />
        <OptimizationSuggestions suggestions={optimizationSuggestions} />
      </div>
      <CorrelationMatrix />
      <TaxReporting />
    </div>
  )
}
