import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";

import { ConfirmDialog } from "@/components/ui";

/**
 * Asks before the app's own navigation (Menu, tab bar, back button, Quick Find)
 * leaves a page that holds unsaved answers. HashRouter has no data router, so
 * react-router's useBlocker is not available; pages register a guard instead.
 */
interface Guard {
  title: string;
  message: string;
}
interface Pending extends Guard {
  to: string | number;
  options?: NavigateOptions;
}
interface LeaveGuardApi {
  register: (id: string, guard: Guard) => () => void;
  isActive: () => boolean;
  go: (to: string | number, options?: NavigateOptions) => void;
}

type Navigate = ReturnType<typeof useNavigate>;
function goToWith(navigate: Navigate, to: string | number, options?: NavigateOptions) {
  if (typeof to === "number") navigate(to);
  else navigate(to, options);
}

const LeaveGuardContext = createContext<LeaveGuardApi | null>(null);

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const guards = useRef(new Map<string, Guard>());
  const [pending, setPending] = useState<Pending | null>(null);
  const goTo = useCallback((to: string | number, options?: NavigateOptions) => goToWith(navigate, to, options), [navigate]);

  const api = useMemo<LeaveGuardApi>(
    () => ({
      register: (id, guard) => {
        guards.current.set(id, guard);
        return () => {
          guards.current.delete(id);
        };
      },
      isActive: () => guards.current.size > 0,
      go: (to, options) => {
        const last = Array.from(guards.current.values()).pop();
        if (!last) goTo(to, options);
        else setPending({ ...last, to, options });
      },
    }),
    [goTo],
  );

  return (
    <LeaveGuardContext.Provider value={api}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        message={pending?.message ?? ""}
        confirmLabel="Leave"
        cancelLabel="Keep going"
        destructive={true}
        onConfirm={() => {
          const target = pending;
          guards.current.clear();
          setPending(null);
          if (target) goTo(target.to, target.options);
        }}
        onCancel={() => setPending(null)}
      />
    </LeaveGuardContext.Provider>
  );
}

let guardCounter = 0;

/** Call from a page while it holds answers that leaving would lose. */
export function useLeaveGuard(active: boolean, title: string, message: string): void {
  const api = useContext(LeaveGuardContext);
  const idRef = useRef("");
  if (!idRef.current) idRef.current = `leave-guard-${++guardCounter}`;
  useEffect(() => {
    if (!api || !active) return undefined;
    return api.register(idRef.current, { title, message });
  }, [api, active, title, message]);
}

/** A navigate that asks first when a page has registered a guard. */
export function useGuardedNavigate(): (to: string | number, options?: NavigateOptions) => void {
  const api = useContext(LeaveGuardContext);
  const navigate = useNavigate();
  return useCallback(
    (to: string | number, options?: NavigateOptions) => {
      if (api) api.go(to, options);
      else goToWith(navigate, to, options);
    },
    [api, navigate],
  );
}

/**
 * For link onClick: when a guard is active, stops the link and asks first;
 * otherwise does nothing, so links behave exactly as before.
 */
export function useGuardedLinkClick(): (event: MouseEvent, to: string, options?: NavigateOptions) => void {
  const api = useContext(LeaveGuardContext);
  return useCallback(
    (event: MouseEvent, to: string, options?: NavigateOptions) => {
      if (!api || !api.isActive()) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      api.go(to, options);
    },
    [api],
  );
}
