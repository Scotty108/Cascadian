import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { OptimizationSuggestion } from "../../types"

interface OptimizationSuggestionsProps {
  suggestions: OptimizationSuggestion[]
}

export function OptimizationSuggestions({ suggestions }: OptimizationSuggestionsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Optimization</CardTitle>
        <CardDescription>Portfolio improvement suggestions</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {suggestions.map((suggestion, index) => (
            <div key={index} className="rounded-lg border p-3">
              <div className="font-medium">{suggestion.title}</div>
              <div className="text-sm text-muted-foreground">{suggestion.description}</div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full">
          Apply Optimizations
        </Button>
      </CardFooter>
    </Card>
  )
}
