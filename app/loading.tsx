import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid grid-cols-12 gap-6">
      <Skeleton className="h-screen lg:col-span-2" />

      <div className="flex flex-col gap-4 p-4 md:p-6 col-span-9">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Skeleton className="h-24 lg:col-span-8" />
          <Skeleton className="h-24 lg:col-span-4" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Skeleton className="h-24 lg:col-span-8" />
          <Skeleton className="h-24 lg:col-span-4" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Skeleton className="h-[400px] lg:col-span-8" />
          <Skeleton className="h-[400px] lg:col-span-4" />
        </div>

        <Skeleton className="h-[400px]" />

        <Skeleton className="h-[200px]" />
      </div>
    </div>
  );
}
