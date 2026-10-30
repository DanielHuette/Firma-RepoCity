// Chooses an existing customer by typing part of the name, e-mail or town.
import { useMemo, useState } from "preact/hooks";
import { listCustomers } from "../api/crm";
import type { Customer } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { ErrorNote } from "./ui";

export function CustomerPicker({ value, onChange, label = "Kunde" }: { value: string; onChange: (id: string) => void; label?: string }) {
  const customers = useAsync(() => listCustomers(), []);
  const [term, setTerm] = useState("");
  const matches = useMemo(() => {
    const all = customers.data ?? [];
    const needle = term.trim().toLowerCase();
    if (needle === "") return all.slice(0, 50);
    return all.filter((customer: Customer) =>
      [customer.name, customer.email ?? "", customer.contact_person, customer.city].some((field) => field.toLowerCase().includes(needle))).slice(0, 50);
  }, [customers.data, term]);
  return (
    <div class="stack stack--tight">
      <label class="field">
        <span>{label}</span>
        <input type="search" placeholder="Name, E-Mail oder Ort eingeben" value={term} onInput={(event) => { setTerm(event.currentTarget.value); }} />
      </label>
      <ErrorNote message={customers.error} />
      <select class="select" size={Math.min(6, Math.max(2, matches.length))} value={value} onChange={(event) => { onChange(event.currentTarget.value); }} aria-label={label}>
        {matches.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}{customer.city === "" ? "" : ` · ${customer.city}`}
          </option>
        ))}
      </select>
      {customers.data?.length === 0 && <p class="small muted">Noch keine Kunden. Lege zuerst unter „Kunden“ einen an.</p>}
    </div>
  );
}
