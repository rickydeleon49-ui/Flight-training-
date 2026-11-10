import { createContext, useContext } from "react";

export interface TopBarState {
  title: string;
  setTitle: (title: string) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export const TopBarContext = createContext<TopBarState | null>(null);

export function useTopBar(): TopBarState | null {
  return useContext(TopBarContext);
}
