import * as React from "react";

import { cn } from "@/lib/utils";

const fieldBase = [
  "w-full rounded-control border border-line bg-surface text-ink",
  "placeholder:text-ink-subtle",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-line-strong",
  "focus-visible:border-lime focus-visible:ring-2 focus-visible:ring-lime/25 focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-negative aria-[invalid=true]:ring-negative/20",
].join(" ");

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders a small trailing affordance, e.g. a clear button. */
  trailing?: React.ReactNode;
  leadingIcon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", trailing, leadingIcon, ...props }, ref) => {
    if (leadingIcon || trailing) {
      return (
        <div className="relative w-full">
          {leadingIcon ? (
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle [&_svg]:size-4"
              aria-hidden
            >
              {leadingIcon}
            </span>
          ) : null}
          <input
            ref={ref}
            type={type}
            className={cn(
              fieldBase,
              "h-10 px-3 text-sm",
              leadingIcon && "pl-9",
              trailing && "pr-10",
              className,
            )}
            {...props}
          />
          {trailing ? (
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {trailing}
            </span>
          ) : null}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cn(fieldBase, "h-10 px-3 text-sm", className)}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldBase, "min-h-20 px-3 py-2 text-sm", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Input, Textarea, fieldBase };
