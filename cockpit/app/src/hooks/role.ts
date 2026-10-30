// Whether the signed-in person is the administrator. Everyone else is refused by the database;
// the app only shows a note instead of buttons that would fail.
import { createContext } from "preact";
import { useEffect, useState } from "preact/hooks";
import { isAdmin } from "../api/cockpit";

/** `undefined` while unknown, then the answer of the database. */
export const AdminContext = createContext<boolean | undefined>(undefined);

export function useAdminStatus(userId: string | undefined): boolean | undefined {
  const [admin, setAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setAdmin(undefined);
    if (userId === undefined) return;
    isAdmin().then(
      (value) => {
        if (active) setAdmin(value);
      },
      () => {
        if (active) setAdmin(false);
      },
    );
    return () => {
      active = false;
    };
  }, [userId]);
  return admin;
}
