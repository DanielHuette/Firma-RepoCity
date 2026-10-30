// Small building blocks shared by the pages.
import type { ComponentChildren } from "preact";
import { useSpring } from "../hooks/motion";
import { euro } from "../lib/format";

export function Loading({ label = "Lädt …" }: { label?: string }) {
  return <p class="muted" role="status">{label}</p>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (message === null) return null;
  return <p class="note note--bad" role="alert">{message}</p>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="muted small">{children}</p>;
}

export type Tone = "" | "gold" | "good" | "bad" | "ink";

export function Badge({ tone = "", children }: { tone?: Tone; children: ComponentChildren }) {
  return <span class={tone === "" ? "badge" : `badge badge--${tone}`}>{children}</span>;
}

const EURO_TEXT = /^(-?[\d.]+,\d{2})\s€$/;

// Euro amounts count up on a spring when they first appear or change; other values stay as they are.
function Value({ value }: { value: string }) {
  const match = EURO_TEXT.exec(value);
  const target = match?.[1] === undefined ? 0 : Number(match[1].replace(/\./g, "").replace(",", "."));
  const animated = useSpring(target, 70, 16);
  return <>{match === null ? value : euro(animated)}</>;
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div class="kpi">
      <div class="kpi__label">{label}</div>
      <div class="kpi__value num"><Value value={value} /></div>
      {hint !== undefined && <div class="small muted">{hint}</div>}
    </div>
  );
}

export function PageHead({ kicker, title, children }: { kicker: string; title: string; children?: ComponentChildren }) {
  return (
    <div class="spread page-head">
      <div class="stack--tight stack">
        <p class="kicker">{kicker}</p>
        <h1>{title}</h1>
      </div>
      {children !== undefined && <div class="cluster">{children}</div>}
    </div>
  );
}

export function Field({ label, children, wide = false }: { label: string; children: ComponentChildren; wide?: boolean }) {
  return (
    <label class={wide ? "field field--wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; count?: number }[]; onChange: (next: T) => void }) {
  return (
    <div class="tabs" role="tablist">
      {options.map((option) => (
        <button key={option.id} type="button" role="tab" aria-selected={value === option.id} onClick={() => { onChange(option.id); }}>
          {option.label}
          {option.count !== undefined && option.count > 0 && <span class="dot num">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
