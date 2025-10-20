import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Protocol } from "../types";
import { formatCurrency } from "../utils";

interface TopProtocolsListProps {
  protocols: Protocol[];
  category: string;
  title: string;
  description: string;
}

export function TopProtocolsList({ protocols, category, title, description }: TopProtocolsListProps) {
  const filteredProtocols = protocols
    .filter((p) => p.category === category)
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {filteredProtocols.map((protocol) => (
            <div key={protocol.id} className="flex items-center gap-4">
              <Avatar className="h-10 w-10">
                <AvatarImage src={protocol.icon || "/placeholder.svg"} alt={protocol.name} />
                <AvatarFallback>{protocol.name.substring(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{protocol.name}</p>
                  <p className="text-sm font-medium">{formatCurrency(protocol.tvl)}</p>
                </div>
                <div className="flex items-center text-xs text-muted-foreground">
                  <span className={cn("mr-1", protocol.tvlChange > 0 ? "text-green-500" : "text-red-500")}>
                    {protocol.tvlChange > 0 ? "+" : ""}
                    {protocol.tvlChange}%
                  </span>
                  <span>in 7d</span>
                  <Badge variant="outline" className="ml-auto">
                    {protocol.apy}% APY
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
