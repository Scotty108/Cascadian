import { Star, StarHalf } from "lucide-react"

interface StarRatingProps {
  rating: number
  showValue?: boolean
  size?: "sm" | "md" | "lg"
}

export function StarRating({ rating, showValue = true, size = "md" }: StarRatingProps) {
  const fullStars = Math.floor(rating)
  const hasHalfStar = rating % 1 >= 0.5

  const sizeClasses = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  }

  const textSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  }

  return (
    <div className="flex items-center">
      {[...Array(fullStars)].map((_, i) => (
        <Star key={`full-${i}`} className={`${sizeClasses[size]} fill-primary text-primary`} />
      ))}
      {hasHalfStar && <StarHalf className={`${sizeClasses[size]} fill-primary text-primary`} />}
      {[...Array(5 - fullStars - (hasHalfStar ? 1 : 0))].map((_, i) => (
        <Star key={`empty-${i}`} className={`${sizeClasses[size]} text-muted-foreground`} />
      ))}
      {showValue && <span className={`ml-1 ${textSizeClasses[size]} font-medium`}>{rating.toFixed(1)}</span>}
    </div>
  )
}
