export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

export function seconds(ms: number | null | undefined): string {
  if (ms == null) return "–";
  return (ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " s";
}

export function monthName(date: string | Date): string {
  return new Date(date).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

export const modeLabel = { solo: "Solo-Quiz", duel: "Duell", challenge: "Gruppen-Challenge" } as const;

export const musicModeLabel = { solo: "Musik solo", duel: "Musik-Duell", challenge: "Musik-Challenge" } as const;

/** Genres der Musikrunde (wie im Startpaket) */
export const GENRES = [
  "Pop", "Rock", "Deutschpop", "Deutschrock", "Hip-Hop", "Deutschrap", "Dance", "Disco",
  "Oldies", "Schlager", "Neue Deutsche Welle", "Austropop", "Soul", "Reggae",
] as const;
