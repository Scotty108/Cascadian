import { TvlTrendsChart } from "../charts/tvl-trends-chart"
import { ProtocolDistributionChart } from "../charts/protocol-distribution-chart"
import { TopProtocolsList } from "../top-protocols-list"
import { GovernanceProposals } from "../governance-proposals"
import type { Protocol, ChartData, DistributionData, GovernanceProposal } from "../../types"

interface OverviewTabProps {
  protocols: Protocol[]
  tvlData: ChartData[]
  distributionData: DistributionData[]
  governanceProposals: GovernanceProposal[]
}

export function OverviewTab({ protocols, tvlData, distributionData, governanceProposals }: OverviewTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <TvlTrendsChart data={tvlData} />
        <ProtocolDistributionChart data={distributionData} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <TopProtocolsList
          protocols={protocols}
          category="Lending"
          title="Top Lending Protocols"
          description="Based on Total Value Locked (TVL)"
        />
        <TopProtocolsList
          protocols={protocols}
          category="DEX"
          title="Top DEX Protocols"
          description="Based on Total Value Locked (TVL)"
        />
        <GovernanceProposals proposals={governanceProposals} />
      </div>
    </div>
  )
}
