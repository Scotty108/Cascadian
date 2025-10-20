import { AssetFilters } from "./asset-filters"
import { AssetsTable } from "./assets-table"
import type { Asset } from "../../../types"

interface AssetsTabProps {
  assets: (Asset & { networkId: string })[]
  activeNetwork: string
  onNetworkChange: (network: string) => void
}

export function AssetsTab({ assets, activeNetwork, onNetworkChange }: AssetsTabProps) {
  return (
    <div className="space-y-4">
      <AssetFilters activeNetwork={activeNetwork} onNetworkChange={onNetworkChange} />
      <AssetsTable assets={assets} />
    </div>
  )
}
