import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "bg-surface-2 text-ink-muted",
        outline: "border border-line-strong text-ink-muted",
        lime: "bg-lime-soft text-lime",
        iris: "bg-iris-soft text-iris",
        aqua: "bg-aqua/12 text-aqua",
        amber: "bg-amber/12 text-amber",
        coral: "bg-coral/12 text-coral",
        limeSolid: "bg-lime text-ink-inverse",
        inkSolid: "bg-ink text-ink-inverse",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px] [&_svg]:size-3",
        md: "px-2.5 py-1 text-xs [&_svg]:size-3.5",
        lg: "px-3 py-1.5 text-[13px] [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

function Badge({ className, variant, size, asChild, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
