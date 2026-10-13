import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-control font-medium transition-[background-color,color,box-shadow,transform,border-color]",
    "duration-150 ease-out-expo select-none",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        lime: "bg-lime text-ink-inverse hover:brightness-105 shadow-card",
        ink: "bg-ink text-ink-inverse hover:opacity-90",
        iris: "bg-iris text-white hover:brightness-110",
        outline:
          "border border-line-strong bg-transparent text-ink hover:bg-surface-2",
        secondary: "bg-surface-2 text-ink hover:bg-surface-3",
        ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
        subtle:
          "bg-lime-soft text-lime hover:brightness-95 dark:hover:brightness-125",
        danger: "bg-negative text-white hover:brightness-110",
        link: "text-lime underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 rounded-[8px] px-2.5 text-xs [&_svg]:size-3.5",
        sm: "h-8 rounded-control px-3 text-[13px] [&_svg]:size-4",
        md: "h-10 px-4 text-sm [&_svg]:size-4",
        lg: "h-11 px-5 text-[15px] [&_svg]:size-[18px]",
        xl: "h-12 px-6 text-base [&_svg]:size-[18px]",
        icon: "size-10 [&_svg]:size-[18px]",
        "icon-sm": "size-8 rounded-[8px] [&_svg]:size-4",
        "icon-xs": "size-7 rounded-[8px] [&_svg]:size-3.5",
      },
      full: { true: "w-full" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Renders a spinner and blocks interaction. */
  loading?: boolean;
  loadingText?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      full,
      asChild = false,
      loading = false,
      loadingText,
      children,
      disabled,
      type,
      ...props
    },
    ref,
  ) => {
    // asChild forwards to a single child element, so a loading spinner cannot
    // be injected without breaking the Slot contract. Loading is ignored there.
    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={cn(buttonVariants({ variant, size, full }), className)}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(buttonVariants({ variant, size, full }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
