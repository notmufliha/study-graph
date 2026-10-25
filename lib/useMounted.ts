import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during server rendering and hydration, true afterwards. For UI that
 * depends on browser-only state (localStorage) and would otherwise cause a
 * hydration mismatch.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
