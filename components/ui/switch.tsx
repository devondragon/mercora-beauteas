"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * Toggle switch.
 *
 * The stock shadcn styling this replaced was written for Tailwind v4 with the
 * shadcn CSS-variable palette (`bg-primary`, `bg-input`, `bg-background`,
 * `ring-ring/50`). This project is Tailwind v3 with a custom brand palette
 * (tailwind.config.ts), where:
 *
 *   - `input` is not a color at all, so the UNCHECKED track had no background;
 *   - `primary` is a scale with no DEFAULT key, so `bg-primary` generates no
 *     rule either and the CHECKED track had no background;
 *   - `background` IS mapped (to the cream surface), so the thumb still painted.
 *
 * The result was a switch that rendered as a floating dot with no visible track
 * in either state, which makes its position — and therefore whether the setting
 * is on — impossible to read. Every class below resolves against the real
 * palette; keep it that way rather than reaching for shadcn's variable names.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
        "border-border-default bg-border-dark",
        "data-[state=checked]:border-primary-600 data-[state=checked]:bg-primary-500",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-white shadow ring-0 transition-transform",
          "data-[state=checked]:translate-x-[1.375rem] data-[state=unchecked]:translate-x-0.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
