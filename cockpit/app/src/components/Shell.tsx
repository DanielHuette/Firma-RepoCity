// Frame of every signed-in page: a sidebar on the left with mark, wordmark, the Cockpit's own pages
// and the RepoCity apps below it. It stays open until Daniel folds it to an icon rail; the choice
// is remembered per browser. On small screens the sidebar becomes a drawer behind a menu button.
import type { ComponentChildren, JSX, RefObject } from "preact";
import { useLocation } from "preact-iso";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Mark, Wordmark } from "./Logo";

type IconName = "zentrale" | "assistent" | "kunden" | "einstellungen" | "radar" | "planer";

const LINKS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/", label: "Zentrale", icon: "zentrale", match: ["/"] },
  { href: "/assistent", label: "Assistent", icon: "assistent", match: ["/assistent"] },
  { href: "/einstellungen", label: "Einstellungen", icon: "einstellungen", match: ["/einstellungen"] },
];

interface External {
  href: string;
  label: string;
  icon: IconName;
}

/** Each opens in its own window. Apps run the company, products are what RepoCity sells. */
const GROUPS: { title: string; items: External[] }[] = [
  {
    title: "Apps",
    items: [
      { href: "https://crm.speedofthespirit.dev/", label: "CRM", icon: "kunden" },
      { href: "https://app.agenticmarketing.speedofthespirit.dev/planer", label: "Marketing", icon: "planer" },
    ],
  },
  { title: "Produkte", items: [{ href: "https://app.radarauditor.speedofthespirit.dev/", label: "RadarAuditor", icon: "radar" }] },
];

const PATHS: Record<IconName, JSX.Element> = {
  planer: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13h3M13.5 13h3M7.5 16.5h3" /></>,
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12l6.4-6.4" /><circle cx="12" cy="12" r="1.2" /></>,
  assistent: <><rect x="9" y="3" width="6" height="11.5" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" /></>,
  zentrale: <><path d="M4 5.5h16v10H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  kunden: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6" /><circle cx="17" cy="9" r="2.6" /><path d="M16.5 14.6c2.6.1 4.4 1.8 5 4.6" /></>,
  einstellungen: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};

function Icon({ name, className = "side__icon" }: { name: IconName; className?: string }) {
  return (
    <svg class={className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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

// The gold pill springs to the active section (measured after each navigation and fold)
function usePill(nav: RefObject<HTMLElement>, deps: readonly unknown[]): { y: number; h: number } | null {
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

function MobileBar({ drawer, pending, onMenu }: { drawer: boolean; pending: number | undefined; onMenu: () => void }) {
  return (
    <header class="mobilebar">
      <button class="mobilebar__menu" type="button" aria-label="Menü öffnen" aria-expanded={drawer} onClick={onMenu}>
        <span /><span /><span />
      </button>
      <a class="brand" href="/" aria-label="RepoCity Cockpit, zur Zentrale">
        <Mark size={28} />
        <span><Wordmark tagline={false} /><small>Cockpit</small></span>
      </a>
      <a class="mobilebar__assistant" href="/assistent" aria-label="Assistent"><Icon name="assistent" className="mobilebar__icon" /></a>
      {pending !== undefined && pending > 0 && <a class="dot num" href="/" aria-label={`${String(pending)} ungelesene Nachrichten`}>{pending}</a>}
    </header>
  );
}

function OwnLinks({ path, folded, pending }: { path: string; folded: boolean; pending: number | undefined }) {
  const active = (match: string[]) => match.some((prefix) => (prefix === "/" ? path === "/" : path.startsWith(prefix)));
  return (
    <>
      {LINKS.map((link) => (
        <a key={link.href} href={link.href} aria-current={active(link.match) ? "page" : undefined} title={folded ? link.label : undefined}>
          <Icon name={link.icon} />
          <span class="side__label">{link.label}</span>
          {link.href === "/" && pending !== undefined && pending > 0 && <span class="dot num">{pending}</span>}
        </a>
      ))}
    </>
  );
}

function AppLinks({ folded }: { folded: boolean }) {
  return (
    <>
      {GROUPS.map((group) => (
        <div key={group.title} class="side__section">
          <span class="side__group" aria-hidden={folded}>{group.title}</span>
          {group.items.map((item) => (
            <a key={item.href} href={item.href} target="_blank" rel="noopener" title={folded ? item.label : undefined}>
              <Icon name={item.icon} />
              <span class="side__label">{item.label}</span>
            </a>
          ))}
        </div>
      ))}
    </>
  );
}

function FoldButton({ folded, onToggle }: { folded: boolean; onToggle: () => void }) {
  return (
    <button class="side__fold" type="button" onClick={onToggle} aria-pressed={folded} aria-label={folded ? "Menü ausklappen" : "Menü einklappen"} title={folded ? "Ausklappen" : "Einklappen"}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={folded ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
      </svg>
      <span class="side__label">Einklappen</span>
    </button>
  );
}

function Sidebar({ path, pending, folded, onToggle }: { path: string; pending: number | undefined; folded: boolean; onToggle: () => void }) {
  const nav = useRef<HTMLElement>(null);
  const pill = usePill(nav, [path, pending, folded]);
  return (
    <aside class="side" aria-label="Hauptmenü">
      <a class="side__brand" href="/" aria-label="RepoCity Cockpit, zur Zentrale">
        <Mark size={folded ? 34 : 40} />
        <span class="side__words"><Wordmark tagline={false} /><small>Cockpit</small></span>
      </a>
      <nav class="side__nav" aria-label="Bereiche" ref={nav}>
        <span class="side__pill" aria-hidden="true" style={pill === null ? { opacity: 0 } : { transform: `translateY(${String(pill.y)}px)`, height: `${String(pill.h)}px` }} />
        <OwnLinks path={path} folded={folded} pending={pending} />
        <AppLinks folded={folded} />
      </nav>
      <FoldButton folded={folded} onToggle={onToggle} />
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
      <MobileBar drawer={drawer} pending={pending} onMenu={() => { setDrawer(true); }} />
      <button class="scrim" type="button" aria-label="Menü schließen" tabIndex={-1} onClick={() => { setDrawer(false); }} />
      <Sidebar path={path} pending={pending} folded={folded} onToggle={toggle} />
      <div class="frame__main">
        {admin === false && (
          <div class="readonly-note" role="status">
            <strong>Kein Zugriff.</strong> Dieses Konto darf das Cockpit nicht nutzen. Melde dich mit dem Administrator-Konto an.
          </div>
        )}
        <main class="page">{children}</main>
      </div>
    </div>
  );
}
