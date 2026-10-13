"use client";

import * as React from "react";

import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Labelled control with inline validation messaging.
 *
 * **Two ways to use it, and both are supported.** Pass the control's props
 * directly and `Field` renders an `Input`; or pass a control as a child when it
 * is not an input — a `Textarea` or a `select`, neither of which can be
 * expressed as `InputProps`. Most of the app's forms need the second form for at
 * least one field, so only supporting the first would mean every one of them
 * reimplementing the label, the `aria-describedby` wiring and the reserved
 * message row.
 *
 * When a child is given, it is cloned to receive the generated `id` and the ARIA
 * attributes rather than being wrapped, because `<label htmlFor>` only works if
 * the control itself carries the id. Wrapping it would have rendered a label
 * pointing at a `div` and silently broken the association for every screen reader
 * user on those forms.
 *
 * The error is wired with `aria-describedby` and `aria-invalid` rather than
 * relying on colour alone, and the message row is reserved with `min-h` so a
 * validation error appearing does not shift the rest of the form down.
 */
export function Field({
  label,
  error,
  hint,
  id,
  className,
  children,
  ...props
}: InputProps & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const control = React.useMemo(() => {
    if (!children) {
      return (
        <Input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
      );
    }

    // A single element child gets the id and ARIA wiring merged in. Anything
    // else (a fragment, a string, several nodes) is rendered untouched, because
    // there is no single control to associate the label with and guessing would
    // be worse than leaving it alone.
    const only = React.Children.count(children) === 1 ? React.Children.only(children) : null;
    if (!React.isValidElement<Record<string, unknown>>(only)) return children;

    return React.cloneElement(only, {
      id: (only.props.id as string | undefined) ?? inputId,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": (only.props["aria-describedby"] as string | undefined) ?? describedBy,
    });
  }, [children, error, describedBy, inputId, props]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      ) : null}

      {control}

      {error ? (
        <p id={errorId} role="alert" className="min-h-4 text-xs text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="min-h-4 text-xs text-ink-subtle">
          {hint}
        </p>
      ) : (
        <div className="min-h-4" />
      )}
    </div>
  );
}
