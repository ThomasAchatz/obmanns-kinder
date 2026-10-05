// Schützenscheibe: jede Frage ist ein Schuss.
// Richtig = Treffer im Spiegel (je schneller, desto näher an der Mitte),
// falsch = Einschuss am Rand, Zeit abgelaufen = knapp daneben.

export type Shot = { position: number; correct: boolean | null; ms: number | null; answered: boolean };

type Props = { shots: Shot[]; size?: number; label?: string; dim?: boolean };

const RINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function shotPoint(s: Shot) {
  const angle = ((-90 + (s.position - 1) * 72 + 14) * Math.PI) / 180;
  let d: number;
  if (s.correct) d = 0.06 + 0.4 * Math.min(1, (s.ms ?? 15000) / 30000);
  else if (s.ms == null || s.ms >= 30000) d = 1.06; // daneben
  else d = 0.78 + 0.12 * ((s.position * 37) % 10) / 10;
  return { x: 50 + Math.cos(angle) * d * 46, y: 50 + Math.sin(angle) * d * 46 };
}

export function Target({ shots, size = 132, label, dim = false }: Props) {
  return (
    <svg
      viewBox="-6 -6 112 112"
      width={size}
      height={size}
      className={dim ? "target target-dim" : "target"}
      role="img"
      aria-label={label ?? `${shots.filter((s) => s.correct).length} von 5 Treffern`}
    >
      <circle cx="50" cy="50" r="46" className="target-paper" />
      {/* Spiegel: Ringe 7–10 */}
      <circle cx="50" cy="50" r={46 * 0.4} className="target-mirror" />
      {RINGS.map((n) => (
        <circle key={n} cx="50" cy="50" r={4.6 * n} className={n <= 4 ? "target-ring-inner" : "target-ring"} />
      ))}
      <circle cx="50" cy="50" r="1.4" className="target-center" />
      {shots
        .filter((s) => s.answered)
        .map((s) => {
          const p = shotPoint(s);
          return (
            <g key={s.position} className={s.correct ? "shot shot-hit" : "shot shot-miss"}>
              <circle cx={p.x} cy={p.y} r="4.2" />
              <circle cx={p.x} cy={p.y} r="1.5" className="shot-core" />
            </g>
          );
        })}
    </svg>
  );
}

/** Logo: Scheibe mit einem Treffer in der Mitte */
export function LogoTarget({ size = 72 }: { size?: number }) {
  return <Target size={size} shots={[{ position: 1, correct: true, ms: 0, answered: true }]} label="Obmanns Kinder" />;
}
