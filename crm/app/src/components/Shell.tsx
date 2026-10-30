// Frame of every signed-in page: a sidebar on the left with mark, wordmark and the sections Daniel
// works in. It stays open until he folds it to an icon rail; the choice is remembered per browser.
// On small screens the sidebar becomes a drawer behind a menu button.
import type { ComponentChildren, JSX, RefObject } from "preact";
import { useLocation } from "preact-iso";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Mark, Wordmark } from "./Logo";

type IconName = "heute" | "kalender" | "kunden" | "verkauf" | "rechnungen" | "finanzen" | "service" | "freigaben" | "einstellungen";

const LINKS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/", label: "Heute", icon: "heute", match: ["/"] },
  { href: "/kalender", label: "Kalender", icon: "kalender", match: ["/kalender"] },
  { href: "/kunden", label: "Kunden", icon: "kunden", match: ["/kunden", "/kunde/"] },
  { href: "/verkauf", label: "Verkauf", icon: "verkauf", match: ["/verkauf", "/angebot/"] },
  { href: "/rechnungen", label: "Rechnungen", icon: "rechnungen", match: ["/rechnungen", "/rechnung/"] },
  { href: "/finanzen", label: "Finanzen", icon: "finanzen", match: ["/finanzen"] },
  { href: "/service", label: "Service", icon: "service", match: ["/service"] },
  { href: "/freigaben", label: "Freigaben", icon: "freigaben", match: ["/freigaben"] },
  { href: "/einstellungen", label: "Einstellungen", icon: "einstellungen", match: ["/einstellungen"] },
];

const PATHS: Record<IconName, JSX.Element> = {
  heute: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></>,
  kalender: <><rect x="3" y="4.5" width="18" height="16.5" rx="2.2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h2.5M14 13.5h2.5M7.5 17h2.5" /></>,
  kunden: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6" /><circle cx="17" cy="9" r="2.6" /><path d="M16.5 14.6c2.6.1 4.4 1.8 5 4.6" /></>,
  verkauf: <><path d="M3 17l5.5-5.5 4 4L21 7" /><path d="M15 7h6v6" /></>,
  rechnungen: <><path d="M6 2.8h9l4 4V21.2H6z" /><path d="M15 2.8v4h4M9 11h7M9 14.5h7M9 18h4" /></>,
  finanzen: <><rect x="2.8" y="5.5" width="18.4" height="13" rx="2" /><path d="M2.8 9.5h18.4M6.5 14.5h4" /></>,
  service: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="2.8" y="13" width="4" height="6" rx="1.4" /><rect x="17.2" y="13" width="4" height="6" rx="1.4" /><path d="M19.2 19c0 1.5-1.6 2.4-4.2 2.4" /></>,
  freigaben: <><path d="M12 2.6l7.5 3v5.6c0 4.8-3.2 8.6-7.5 10.2-4.3-1.6-7.5-5.4-7.5-10.2V5.6z" /><path d="M8.6 12.2l2.4 2.4 4.6-5" /></>,
  einstellungen: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg class="side__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const STORAGE_KEY = "crm.sidebar.folded";

function readFolded(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

function useFolded(): [boolean, () => void] {
  const [folded, setFolded] = useState(readFolded);
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* the choice just is not remembered */ }
  };
  return [folded, toggle];
}

// The gold pill springs to the active section, measured after each navigation and fold.
function usePill(nav: RefObject<HTMLElement>, deps: unknown[]): { y: number; h: number } | null {
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const current = nav.current?.querySelector<HTMLElement>('a[aria-current="page"]');
      setPill(current === null || current === undefined ? null : { y: current.offsetTop, h: current.offsetHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); };
  }, deps);
  return pill;
}

function MobileBar({ drawer, pending, onOpen }: { drawer: boolean; pending: number | undefined; onOpen: () => void }) {
  return (
    <header class="mobilebar">
      <button class="mobilebar__menu" type="button" aria-label="Menü öffnen" aria-expanded={drawer} onClick={onOpen}>
        <span /><span /><span />
      </button>
      <a class="brand" href="/" aria-label="RepoCity CRM, zur Startseite">
        <Mark size={28} />
        <span><Wordmark tagline={false} /><small>CRM</small></span>
      </a>
      {pending !== undefined && pending > 0 && <a class="dot num" href="/freigaben" aria-label={`${String(pending)} Freigaben`}>{pending}</a>}
    </header>
  );
}

function SideNav({ path, folded, pending }: { path: string; folded: boolean; pending: number | undefined }) {
  const nav = useRef<HTMLElement>(null);
  const pill = usePill(nav, [path, pending, folded]);
  const active = (match: string[]) => match.some((prefix) => (prefix === "/" ? path === "/" : path.startsWith(prefix)));
  return (
    <nav class="side__nav" aria-label="Bereiche" ref={nav}>
      <span class="side__pill" aria-hidden="true" style={pill === null ? { opacity: 0 } : { transform: `translateY(${String(pill.y)}px)`, height: `${String(pill.h)}px` }} />
      {LINKS.map((link) => (
        <a key={link.href} href={link.href} aria-current={active(link.match) ? "page" : undefined} title={folded ? link.label : undefined}>
          <Icon name={link.icon} />
          <span class="side__label">{link.label}</span>
          {link.href === "/freigaben" && pending !== undefined && pending > 0 && <span class="dot num">{pending}</span>}
        </a>
      ))}
    </nav>
  );
}

function Side({ path, folded, pending, onToggle }: { path: string; folded: boolean; pending: number | undefined; onToggle: () => void }) {
  return (
    <aside class="side" aria-label="Hauptmenü">
      <a class="side__brand" href="/" aria-label="RepoCity CRM, zur Startseite">
        <Mark size={folded ? 34 : 40} />
        <span class="side__words"><Wordmark tagline={false} /><small>CRM</small></span>
      </a>
      <SideNav path={path} folded={folded} pending={pending} />
      <button class="side__fold" type="button" onClick={onToggle} aria-pressed={folded} aria-label={folded ? "Menü ausklappen" : "Menü einklappen"} title={folded ? "Ausklappen" : "Einklappen"}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d={folded ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
        </svg>
        <span class="side__label">Einklappen</span>
      </button>
    </aside>
  );
}

export function Shell({ children, admin, pending }: { children: ComponentChildren; admin?: boolean | undefined; pending?: number }) {
  const { path } = useLocation();
  const [folded, toggle] = useFolded();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setDrawer(false); }, [path]);
  return (
    <div class={`frame${folded ? " frame--folded" : ""}${drawer ? " frame--drawer" : ""}`}>
      <MobileBar drawer={drawer} pending={pending} onOpen={() => { setDrawer(true); }} />
      <button class="scrim" type="button" aria-label="Menü schließen" tabIndex={-1} onClick={() => { setDrawer(false); }} />
      <Side path={path} folded={folded} pending={pending} onToggle={toggle} />
      <div class="frame__main">
        {admin === false && (
          <div class="readonly-note" role="status">
            <strong>Kein Zugriff.</strong> Dieses Konto darf das CRM nicht bearbeiten. Melde dich mit dem Administrator-Konto an.
          </div>
        )}
        <main class="page">{children}</main>
      </div>
    </div>
  );
}
