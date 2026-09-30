// 来源 assistant-ui f008537，MIT；保留官方布局，Studio 适配见 UI-STARTER.md。
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

const subscribe = (onStoreChange: () => void) => {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
};

const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT;

const getServerSnapshot = () => false;

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
