// Schallplatte als Gegenstück zur Schützenscheibe.
// Jeder Song ist eine Rille (außen = Song 1). Obere Hälfte leuchtet, wenn der
// Interpret stimmte, untere Hälfte, wenn der Titel stimmte.

export type Groove = { artist: boolean | null; title: boolean | null } | null;

type Props = {
  grooves?: Groove[];
  size?: number;
  spinning?: boolean;
  artwork?: string | null;
  label?: string;
  dim?: boolean;
  /** Welche Rille gerade läuft (1–5), wird dezent hervorgehoben */
  current?: number;
};

const R_OUT = 46;
const R_LABEL = 16.5;
const BAND = (R_OUT - 2 - R_LABEL - 1) / 5;

function radius(position: number) {
  return R_OUT - 2 - BAND * (position - 0.5);
}

function Half({ r, top, lit }: { r: number; top: boolean; lit: boolean | null }) {
  const c = 2 * Math.PI * r;
  return (
    <circle
      cx="50"
      cy="50"
      r={r}
      className={lit ? "groove-lit" : lit === false ? "groove-miss" : "groove-off"}
      strokeWidth={lit ? BAND * 0.52 : BAND * 0.3}
      strokeDasharray={`${c / 2 - 1.2} ${c}`}
      transform={`rotate(${top ? 180.4 : 0.4} 50 50)`}
      fill="none"
    />
  );
}

export function Record({ grooves = [], size = 160, spinning = false, artwork, label, dim = false, current }: Props) {
  const hits = grooves.reduce((s, g) => s + (g?.artist ? 1 : 0) + (g?.title ? 1 : 0), 0);
  const id = artwork ? `rec-${Math.abs(hashCode(artwork))}` : "";
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`record${spinning ? " is-spinning" : ""}${dim ? " record-dim" : ""}`}
      role="img"
      aria-label={label ?? `${hits} von 10 Punkten`}
    >
      {artwork && (
        <defs>
          <clipPath id={id}>
            <circle cx="50" cy="50" r={R_LABEL} />
          </clipPath>
        </defs>
      )}
      <g className="record-disc">
        <circle cx="50" cy="50" r={R_OUT} className="record-vinyl" />
        {[1, 2, 3, 4, 5].map((p) => (
          <circle key={p} cx="50" cy="50" r={radius(p)} className={p === current ? "record-groove now" : "record-groove"} />
        ))}
        {grooves.map((g, i) =>
          g ? (
            <g key={i}>
              <Half r={radius(i + 1)} top lit={g.artist} />
              <Half r={radius(i + 1)} top={false} lit={g.title} />
            </g>
          ) : null,
        )}
        {artwork ? (
          <image href={artwork} x={50 - R_LABEL} y={50 - R_LABEL} width={R_LABEL * 2} height={R_LABEL * 2} clipPath={`url(#${id})`} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <circle cx="50" cy="50" r={R_LABEL} className="record-label" />
        )}
        <circle cx="50" cy="50" r={R_LABEL} className="record-label-edge" />
        <circle cx="50" cy="50" r="1.6" className="record-hole" />
      </g>
      <path d="M50 4 A46 46 0 0 1 82.5 17.5 L50 50 Z" className="record-sheen" />
    </svg>
  );
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
