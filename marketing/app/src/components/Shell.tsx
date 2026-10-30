// Frame of every signed-in page: navy bar with the mark, the sections and the page body.
import type { ComponentChildren } from "preact";
import { useLocation } from "preact-iso";

const LINKS = [
  { href: "/", label: "Kampagnen" },
  { href: "/planer", label: "Planer" },
  { href: "/anleitung", label: "Anleitung" },
  { href: "/einstellungen", label: "Einstellungen" },
];

export function Shell({ children, admin }: { children: ComponentChildren; admin?: boolean | undefined }) {
  const { path } = useLocation();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/kampagne") || path.startsWith("/beitrag") : path.startsWith(href));
  return (
    <>
      <header class="topbar">
        <div class="topbar__inner">
          <a class="brand" href="/">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span>
              Agentic Marketing
              <small>Cockpit</small>
            </span>
          </a>
          <nav aria-label="Bereiche">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} aria-current={active(link.href) ? "page" : undefined}>
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {admin === false && (
        <div class="readonly-note" role="status">
          <strong>Nur Lesen.</strong> Du kannst alles ansehen, aber nichts freigeben, ändern oder starten. Das darf nur der Administrator.
        </div>
      )}
      <main class="page">{children}</main>
    </>
  );
}
