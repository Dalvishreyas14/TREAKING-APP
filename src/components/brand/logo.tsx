import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The LIFEOS mark.
 *
 * A rounded black tile holding the multicolour LIFEOS symbol, shipped as a
 * 512x512 PNG at `public/logo-mark.png` (the favicon at `src/app/icon.png` is
 * the same asset). The tile is baked into the image, so the mark reads the same
 * in the light and dark themes without a variant.
 *
 * This file is the single source of truth for LIFEOS branding. The sidebar, top
 * bar, auth screens, landing page and splash all read from here; nothing else in
 * the app draws a wordmark.
 *
 * The symbol and the type are exported separately as well as composed, because
 * the splash fades them in on different beats and needs the wordmark without the
 * mark beside it.
 */

/** The symbol on its own: sidebar, favicon, splash, and small screens. */
export function Logo({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={cn("shrink-0 rounded-[28%]", className)}
    />
  );
}

/**
 * The wordmark on its own.
 *
 * Split out so callers that animate the symbol and the type separately — the
 * splash — do not have to restate the type treatment. `className` is merged with
 * `tailwind-merge`, so a caller can override size and colour without fighting
 * specificity.
 *
 * The weight and the wide tracking are taken from the LIFEOS logo asset rather
 * than invented: the letters are widely spaced, and `ink` reproduces the
 * near-white of the wordmark without hardcoding a hex value that would then be
 * wrong in the light theme.
 */
export function WordmarkText({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-[15px] font-semibold tracking-[0.18em] text-ink",
        className,
      )}
    >
      LIFEOS
    </span>
  );
}

/**
 * The mark plus the wordmark, as used in the app shell, the auth screens and the
 * site header.
 *
 * `textClassName` exists so the responsive rule — symbol only on the narrowest
 * screens — is expressed once, here, instead of being re-decided at each call
 * site. Pass a `hidden sm:inline` class where space is genuinely tight.
 */
export function Wordmark({
  className,
  size = 28,
  showText = true,
  textClassName,
}: {
  className?: string;
  size?: number;
  showText?: boolean;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo size={size} />
      {showText ? <WordmarkText className={textClassName} /> : null}
    </span>
  );
}