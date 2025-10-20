import type React from "react"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Check, X } from "lucide-react"
import { PASSWORD_REQUIREMENTS } from "../../constants"

interface PasswordStrengthProps {
  password: string
  score: number
  feedback: string[]
  strengthLabel: string
  strengthColor: string
}

export const PasswordStrength: React.FC<PasswordStrengthProps> = ({
  password,
  score,
  feedback,
  strengthLabel,
  strengthColor,
}) => {
  const progressValue = (score / 5) * 100

  const getProgressColor = () => {
    if (score <= 1) return "bg-destructive"
    if (score <= 2) return "bg-destructive"
    if (score <= 3) return "bg-yellow-500"
    if (score <= 4) return "bg-blue-500"
    return "bg-green-500"
  }

  const getBadgeVariant = () => {
    if (strengthColor === "destructive") return "destructive"
    if (strengthColor === "warning") return "secondary"
    if (strengthColor === "success") return "default"
    return "outline"
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Password Strength</span>
        <Badge variant={getBadgeVariant()}>{strengthLabel}</Badge>
      </div>

      <Progress
        value={progressValue}
        className="h-2"
        style={
          {
            "--progress-background": getProgressColor(),
          } as React.CSSProperties
        }
      />

      {password && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Requirements:</p>
          <div className="grid grid-cols-1 gap-1">
            {PASSWORD_REQUIREMENTS.map((requirement, index) => {
              const isMet = !feedback.includes(requirement)
              return (
                <div key={index} className="flex items-center space-x-2 text-sm">
                  {isMet ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={isMet ? "text-green-600" : "text-muted-foreground"}>{requirement}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
