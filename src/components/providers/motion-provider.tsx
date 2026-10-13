"use client";

import * as React from "react";
import { MotionConfig } from "framer-motion";

/**
 * App-wide Framer Motion configuration.
 *
 * `reducedMotion="user"` makes Framer Motion honour the OS-level
 * "Reduce motion" setting on its own, so every `motion` component below this
 * provider respects it without each one re-implementing the check. This is a
 * client component because Framer Motion is; the server layout renders it as an
 * opaque boundary.
 *
 * globals.css carries a matching CSS-level kill switch for the CSS-driven
 * animations, which this provider does not govern.
 */
export function MotionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  );
}