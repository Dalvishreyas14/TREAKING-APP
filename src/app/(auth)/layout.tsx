/**
 * Shared layout for the unauthenticated screens.
 *
 * Its only job is the skip link, which must be the first focusable element on
 * every page in this group. The visual shell lives in AuthShell so it can be
 * reused by any future auth screen without inheriting this wrapper.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:border focus:border-line focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
      >
        Skip to form
      </a>
      {children}
    </>
  );
}
