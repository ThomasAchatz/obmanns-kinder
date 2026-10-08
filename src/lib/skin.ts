import { useEffect, useState } from "react";

// Design-Auswahl pro Gerät: „klassisch“ (Loden & Messing) oder „heft“ (Rätselheft).
export type Skin = "klassisch" | "heft" | "pop";
export const SKINS: { id: Skin; label: string }[] = [
  { id: "klassisch", label: "Klassisch" },
  { id: "heft", label: "Rätselheft" },
  { id: "pop", label: "Pop Art" },
];
const THEME: Record<Skin, string> = { klassisch: "#24412F", heft: "#161514", pop: "#ffe600" };
const KEY = "obmanns-design";

export function readSkin(): Skin {
  try {
    const v = localStorage.getItem(KEY);
    return v === "heft" || v === "pop" ? v : "klassisch";
  } catch {
    return "klassisch";
  }
}

export function applySkin(skin: Skin) {
  const root = document.documentElement;
  if (skin === "klassisch") delete root.dataset.skin;
  else root.dataset.skin = skin;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", THEME[skin]);
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
