"use client"

import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react"
import { cn } from "cn"

type ToastType = "default" | "success" | "error"

const toastManager = ToastPrimitive.createToastManager()

function toast(
  title: React.ReactNode,
  options?: { description?: React.ReactNode; type?: ToastType; timeout?: number }
) {
  return toastManager.add({
    title,
    description: options?.description,
    type: options?.type ?? "default",
    timeout: options?.timeout,
  })
}

toast.success = (title: React.ReactNode, description?: React.ReactNode) =>
  toast(title, { description, type: "success" })
toast.error = (title: React.ReactNode, description?: React.ReactNode) =>
  toast(title, { description, type: "error", timeout: 6000 })

const TYPE_ICON: Record<ToastType, React.ReactNode> = {
  default: <Info className="h-4 w-4 shrink-0 text-muted-foreground" />,
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />,
  error: <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />,
}

/**
 * Renders the toast viewport. Mount once near the root (already wired in
 * app/layout.tsx). Fire toasts from anywhere with the `toast()` helper.
 */
function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} timeout={4500} limit={3}>
      <ToastViewport />
    </ToastPrimitive.Provider>
  )
}

function ToastViewport() {
  const { toasts } = ToastPrimitive.useToastManager()
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        // Above the mobile tab bar (h-16 + safe area) on small screens,
        // bottom-right on desktop.
        className="fixed inset-x-4 bottom-20 z-[100] flex flex-col items-center gap-2 outline-none md:inset-x-auto md:right-6 md:bottom-6 md:w-96 md:items-end"
      >
        {toasts.map((t) => {
          const type = (t.type as ToastType | undefined) ?? "default"
          return (
            <ToastPrimitive.Root
              key={t.id}
              toast={t}
              data-slot="toast"
              data-type={type}
              swipeDirection={["down", "right"]}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none",
                "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-4"
              )}
            >
              {TYPE_ICON[type]}
              <div className="grid flex-1 gap-0.5">
                <ToastPrimitive.Title
                  data-slot="toast-title"
                  className="text-sm font-medium tracking-tight"
                />
                <ToastPrimitive.Description
                  data-slot="toast-description"
                  className="text-sm text-muted-foreground"
                />
              </div>
              <ToastPrimitive.Close
                data-slot="toast-close"
                aria-label="Dismiss notification"
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X className="h-3.5 w-3.5" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          )
        })}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  )
}

export { Toaster, toast, toastManager }
export type { ToastType }
