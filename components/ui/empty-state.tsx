import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
}

/**
 * Placeholder for a genuinely empty list (no history entries, no filter
 * results, nothing cached). Not for loading states — use Skeleton there.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium tracking-tight">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export { EmptyState }
