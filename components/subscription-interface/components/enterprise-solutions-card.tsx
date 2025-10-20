import { Check, Users, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ENTERPRISE_FEATURES } from "../constants"

export function EnterpriseSolutionsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enterprise Solutions</CardTitle>
        <CardDescription>Custom plans for teams and businesses</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-bold">Team Plan</h3>
              <p className="text-sm text-muted-foreground">For small to medium teams</p>
            </div>
          </div>
          <ul className="mb-4 space-y-2 text-sm">
            {ENTERPRISE_FEATURES.TEAM.map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Button className="w-full">Contact Sales</Button>
        </div>

        <div className="rounded-lg border p-4">
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-bold">Enterprise Plan</h3>
              <p className="text-sm text-muted-foreground">For large organizations</p>
            </div>
          </div>
          <ul className="mb-4 space-y-2 text-sm">
            {ENTERPRISE_FEATURES.ENTERPRISE.map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Button className="w-full">Request Demo</Button>
        </div>
      </CardContent>
    </Card>
  )
}
