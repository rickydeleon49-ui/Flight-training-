import { MORE_PREFIXES } from "./IosTabBar";

export interface BackTarget {
  to: string;
  label: string;
}

/** Where the iPhone back button leads from this page, or null on a tab's first page. */
export function backTarget(pathname: string): BackTarget | null {
  const parts = pathname.split("/").filter(Boolean);
  const [first, second, third] = parts;
  const at = (...keep: number[]) => `/${keep.map((i) => parts[i]).join("/")}`;

  if (first === "study") {
    if (second === "history") {
      if (parts.length === 2) return { to: "/study", label: "Study" };
      if (parts.length === 3) return { to: "/study/history", label: "History" };
      if (parts.length === 4) return { to: at(0, 1, 2), label: "Attempts" };
      return null;
    }
    if (second === "homework") return parts.length <= 3 ? { to: "/study", label: "Study" } : null;
    return parts.length === 2 ? { to: "/study", label: "Study" } : null;
  }
  if (first === "schedule") return parts.length === 2 ? { to: "/schedule", label: "Schedule" } : null;
  if (first === "journal") {
    if (parts.length === 2) return { to: "/journal", label: "Log" };
    if (parts.length === 3 && third === "edit") return { to: at(0, 1), label: "Entry" };
    return null;
  }
  if (first === "flight-path" && parts.length >= 2) {
    return parts.length === 3 && second === "skills" ? { to: "/flight-path", label: "Flight Path" } : null;
  }
  if (first && MORE_PREFIXES.includes(`/${first}`) && first !== "more") {
    return parts.length === 1 ? { to: "/more", label: "More" } : null;
  }
  return null;
}
