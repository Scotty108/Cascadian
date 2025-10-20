import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GovernanceProposal } from "../types";

interface GovernanceProposalsProps {
  proposals: GovernanceProposal[];
}

export function GovernanceProposals({ proposals }: GovernanceProposalsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Governance</CardTitle>
        <CardDescription>Latest governance proposals</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <div key={proposal.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Badge>{proposal.protocol}</Badge>
                <Badge variant="outline" className="capitalize">
                  {proposal.status}
                </Badge>
              </div>
              <h4 className="mt-2 font-medium">{proposal.title}</h4>
              <p className="text-sm text-muted-foreground">{proposal.description}</p>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span>Ends in {proposal.endDate}</span>
                <span className="text-green-500">{proposal.forPercentage}% For</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
