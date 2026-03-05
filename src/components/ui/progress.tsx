import * as React from "react"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    value?: number
    max?: number
    indeterminate?: boolean
  }
>(({ className, value = 0, max = 100, indeterminate = false, ...props }, ref) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      {indeterminate ? (
        <div
          className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-primary to-accent"
          style={{ animation: "progress-indeterminate 1.2s ease-in-out infinite" }}
        />
      ) : (
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      )}
    </div>
  )
})
Progress.displayName = "Progress"

export { Progress }
