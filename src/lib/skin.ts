import { useEffect, useState } from "react";

// Design-Auswahl pro Gerät: „klassisch“ (Loden & Messing) oder „heft“ (Rätselheft).
export type Skin = "klassisch" | "heft";
const KEY = "obmanns-design";

export function readSkin(): Skin {
  try {
    return localStorage.getItem(KEY) === "heft" ? "heft" : "klassisch";
  } catch {
    return "klassisch";
  }
}

export function applySkin(skin: Skin) {
  const root = document.documentElement;
  if (skin === "heft") root.dataset.skin = "heft";
  else delete root.dataset.skin;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", skin === "heft" ? "#161514" : "#24412F");
}

export function useSkin(): [Skin, (s: Skin) => void] {
  const [skin, setSkin] = useState<Skin>(readSkin);
  useEffect(() => {
    const on = () => setSkin(readSkin());
    window.addEventListener("obmanns-skin", on);
    return () => window.removeEventListener("obmanns-skin", on);
  }, []);
  return [
    skin,
    (s: Skin) => {
      try {
        localStorage.setItem(KEY, s);
      } catch {
        /* privater Modus: gilt dann nur bis zum Neuladen */
      }
      applySkin(s);
      setSkin(s);
      window.dispatchEvent(new Event("obmanns-skin"));
    },
  ];
}
