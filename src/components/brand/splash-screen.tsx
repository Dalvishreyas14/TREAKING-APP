"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Logo, WordmarkText } from "./logo";

/**
 * The LIFEOS splash.
 *
 * Two decisions worth stating. First, it is an overlay rather than a gate: the
 * app renders underneath it from the first paint, so nothing is blocked and
 * there is no layout shift when it clears. Second, it plays at most once per
 * session. A splash that repeats on every route change reads as latency; the
 * same animation on a fresh tab reads as intent.
 *
 * The "have we played" flag lives in sessionStorage, which is external state, so
 * it is read through `useSyncExternalStore` rather than copied into an effect.
 * Reading it during render is also what keeps the server and client markup
 * identical on the first pass: the snapshot function returns a boolean, so the
 * value is stable between renders and hydration stays quiet.
 *
 * The background is the `bg-canvas` token rather than a hardcoded black. In the
 * default dark theme that is near-black (#0a0b0f); in the light theme it stays
 * light, so nobody is flashed a dark overlay they did not ask for.
 */

const SESSION_KEY = "lifeos:splash-seen";

/** How long the mark is held before the splash begins to clear. */
const HOLD_MS = 1250;
const REDUCED_HOLD_MS = 420;

/** `--ease-out-expo`, the curve the rest of the app animates on. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hasSeenSplash() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    // Storage is unavailable in some private modes. Treating this as "not seen"
    // means the splash plays rather than silently never appearing.
    return false;
  }
}

/** Returns a primitive, so `useSyncExternalStore` sees a stable value. */
function getSnapshot() {
  return hasSeenSplash();
}

/**
 * The splash is present in the server-rendered markup on purpose: it is an
 * overlay on top of an app that renders anyway, so painting it in the first
 * response costs no perceived load time and the mark is already sharp when the
 * animation begins.
 */
function getServerSnapshot() {
  return false;
}

function markSplashSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Non-fatal. `dismissed` below still clears the splash for this mount; worst
    // case it plays again on the next load.
  }
  for (const listener of listeners) listener();
}

export function SplashScreen() {
  const reduce = useReducedMotion() ?? false;
  const seen = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /**
   * The local half of the state. Storage alone cannot be trusted to hide the
   * splash: if the write above fails, the snapshot never flips and the overlay
   * would sit on top of the app indefinitely. This guarantees it always clears.
   */
  const [dismissed, setDismissed] = React.useState(false);
  const show = !seen && !dismissed;

  React.useEffect(() => {
    if (!show) return;

    const timer = window.setTimeout(() => {
      markSplashSeen();
      setDismissed(true);
    }, reduce ? REDUCED_HOLD_MS : HOLD_MS);

    return () => window.clearTimeout(timer);
  }, [show, reduce]);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="lifeos-splash"
          aria-hidden
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-canvas"
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          <div className="flex flex-col items-center">
            {/*
              The pulse lives on the outer wrapper and the entrance on the inner
              one, so the final scale pulse cannot cancel the blur-to-sharp
              entrance partway through.
            */}
            <motion.div
              className="relative"
              animate={reduce ? undefined : { scale: [1, 1.015, 1] }}
              transition={{ duration: 0.36, ease: EASE, delay: 0.95, times: [0, 0.5, 1] }}
            >
              {/* Behind the mark, never over it, so the mark's edges stay crisp. */}
              <motion.div
                className="bloom-cyan pointer-events-none absolute -inset-10"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: reduce ? 0 : 1.2,
                  ease: EASE,
                  delay: reduce ? 0 : 0.1,
                }}
              />

              <motion.div
                initial={
                  reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(12px)" }
                }
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                transition={{
                  duration: reduce ? 0.25 : 0.7,
                  ease: EASE,
                  delay: reduce ? 0 : 0.08,
                }}
              >
                <Logo size={96} />
              </motion.div>
            </motion.div>

            <motion.div
              className="mt-8"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduce ? 0.25 : 0.45,
                ease: EASE,
                delay: reduce ? 0.05 : 0.52,
              }}
            >
              <WordmarkText className="text-2xl" />
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}