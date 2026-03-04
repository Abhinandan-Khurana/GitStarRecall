import * as React from "react"

import { cn } from "@/lib/utils"

const Tooltip = ({
  children,
  content,
  side = "top",
}: {
  children: React.ReactNode
  content: string
  side?: "top" | "bottom" | "left" | "right"
}) => {
  return (
    <div className="group relative inline-flex">
      {children}
      <div
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md border border-border opacity-0 transition-opacity group-hover:opacity-100",
          side === "top" && "bottom-full left-1/2 mb-2 -translate-x-1/2",
          side === "bottom" && "top-full left-1/2 mt-2 -translate-x-1/2",
          side === "left" && "right-full top-1/2 mr-2 -translate-y-1/2",
          side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2"
        )}
      >
        {content}
      </div>
    </div>
  )
}

export { Tooltip }
