import { useEffect, useState } from "react";

// Hash-Routing (#/spiel/12), damit GitHub Pages beim Neuladen keine 404 liefert.
function current(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h || "/";
}

export function useRoute(): string {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => setRoute(current());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(path: string, replace = false) {
  const target = "#" + path;
  if (replace) window.location.replace(target);
  else window.location.hash = path;
}

/** "/spiel/12" gegen "/spiel/:id" → { id: "12" } */
export function match(pattern: string, route: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const r = route.split("?")[0].split("/").filter(Boolean);
  if (p.length !== r.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(r[i]);
    else if (p[i] !== r[i]) return null;
  }
  return params;
}
