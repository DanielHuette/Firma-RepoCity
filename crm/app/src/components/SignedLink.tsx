// Opens a private file through a short-lived signed link. The tab opens synchronously so pop-up
// blockers allow it; the link follows once the server has signed it.
import { useAction } from "../hooks/useAsync";

export function SignedLink({ label, sign, button = false }: { label: string; sign: () => Promise<string>; button?: boolean }) {
  const action = useAction();
  const open = () => {
    const tab = window.open("", "_blank");
    void action.run(async () => {
      const url = await sign();
      if (tab === null) window.location.href = url; else tab.location.href = url;
    }).then((ok) => { if (!ok) tab?.close(); });
  };
  return (
    <>
      <button class={button ? "button" : "link-button"} type="button" onClick={open} disabled={action.busy}>{label}</button>
      {action.error !== null && <span class="small late"> {action.error}</span>}
    </>
  );
}
