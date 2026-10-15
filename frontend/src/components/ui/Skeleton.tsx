import React from 'react'

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => {
  return <div className={`animate-pulse bg-[#F1F5F2] rounded-lg ${className}`} />
}

export const SkeletonCard: React.FC = () => {
  return (
    <div className="p-5 border border-[#E1E8E4] rounded-xl bg-[#FFFFFF] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <div className="pt-2 flex justify-between items-center">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </div>
  )
}
