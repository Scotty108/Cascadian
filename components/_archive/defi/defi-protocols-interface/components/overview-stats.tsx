import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface OverviewStatsProps {
  totalTvl: string
  tvlChange: string
  activeProtocols: number
  newProtocols: number
  averageApy: string
  apyChange: string
  userExposure: string
  exposureChange: string
}

export function OverviewStats({
  totalTvl,
  tvlChange,
  activeProtocols,
  newProtocols,
  averageApy,
  apyChange,
  userExposure,
  exposureChange,
}: OverviewStatsProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Value Locked</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalTvl}</div>
          <p className="text-xs text-muted-foreground">
            <span className="text-green-500 font-medium">{tvlChange}</span> from last month
          </p>
          <div className="mt-4 h-1 w-full bg-muted">
            <div className="h-1 bg-primary" style={{ width: "68%" }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Active Protocols</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeProtocols}</div>
          <p className="text-xs text-muted-foreground">
            <span className="text-green-500 font-medium">+{newProtocols}</span> new this month
          </p>
          <div className="mt-4 h-1 w-full bg-muted">
            <div className="h-1 bg-primary" style={{ width: "82%" }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Average APY</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{averageApy}</div>
          <p className="text-xs text-muted-foreground">
            <span className="text-red-500 font-medium">{apyChange}</span> from last month
          </p>
          <div className="mt-4 h-1 w-full bg-muted">
            <div className="h-1 bg-primary" style={{ width: "48%" }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Your Exposure</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{userExposure}</div>
          <p className="text-xs text-muted-foreground">
            <span className="text-green-500 font-medium">{exposureChange}</span> from last month
          </p>
          <div className="mt-4 h-1 w-full bg-muted">
            <div className="h-1 bg-primary" style={{ width: "35%" }} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
