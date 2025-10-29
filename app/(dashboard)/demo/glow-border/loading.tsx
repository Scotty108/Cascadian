export default function GlowBorderLoading() {
  return (
    <div className="shadow-sm rounded-2xl overflow-hidden border-0 dark:bg-[#18181b] bg-white animate-pulse">
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <div className="h-8 bg-muted rounded w-1/3 mb-2"></div>
        <div className="h-4 bg-muted rounded w-2/3"></div>
      </div>
      <div className="px-6 py-6">
        <div className="h-64 bg-muted rounded"></div>
      </div>
    </div>
  );
}
