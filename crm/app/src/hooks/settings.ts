// Company settings, loaded once after sign-in and shared by every page.
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Settings } from "../api/types";

export const SettingsContext = createContext<{ settings: Settings | undefined; reload: () => void }>({ settings: undefined, reload: () => undefined });

export function useSettings(): { settings: Settings | undefined; reload: () => void } {
  return useContext(SettingsContext);
}
