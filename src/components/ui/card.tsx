import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card is the single surface primitive. Every panel in the product is a Card
 * with a tone and an optional interactive flag, which keeps padding, radius and
 * border treatment consistent without a dozen near-identical components.
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    tone?: "default" | "sunken" | "raised" | "glass" | "outline";
    interactive?: boolean;
  }
>(({ className, tone = "default", interactive, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-card",
      tone === "default" && "border border-line bg-surface shadow-card",
      tone === "sunken" && "border border-line bg-canvas-sunken",
      tone === "raised" && "border border-line bg-surface-2 shadow-card",
      tone === "glass" && "glass border border-line shadow-pop",
      tone === "outline" && "border border-line-strong bg-transparent",
      interactive &&
        "cursor-pointer transition-[border-color,transform,box-shadow] duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1 p-5 pb-0", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-ink-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center gap-3 border-t border-line px-5 py-3.5",
      className,
    )}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
