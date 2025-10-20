interface PortfolioHeaderProps {
  title: string
  description: string
}

export function PortfolioHeader({ title, description }: PortfolioHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  )
}
