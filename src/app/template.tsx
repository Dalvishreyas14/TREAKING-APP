/**
 * Next.js remounts a template on every navigation, so the CSS animation on the
 * wrapper replays each time the user changes route. That keeps this a server
 * component: no client JavaScript is involved, only a stylesheet class.
 *
 * Opacity-only and short by design. Animating position or size here reads as
 * lag on every click, which is the problem `data-scroll-behavior="smooth"` in
 * layout.tsx exists to avoid.
 */
export default function Template({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="animate-fade">{children}</div>;
}