import { useState, type MouseEvent } from "react";
import { useAuth } from "../lib/auth";
import { modeLabel, timeAgo } from "../lib/format";
import { navigate } from "../lib/router";
import { rpc } from "../lib/supabase";
import type { GameListItem } from "../lib/types";
import { toast } from "./ui";

function title(g: GameListItem, me: string) {
  const others = g.players.filter((p) => p.user_id !== me);
  if (g.mode === "solo") return `${g.category?.icon ?? ""} ${g.category?.name ?? "Solo-Quiz"}`;
  if (g.mode === "duel") return `Duell mit ${others[0]?.display_name ?? "?"}`;
  return `Challenge mit ${others.length} ${others.length === 1 ? "Person" : "Leuten"}`;
}

function statusLine(g: GameListItem, me: string) {
  const mine = g.players.find((p) => p.user_id === me);
  const others = g.players.filter((p) => p.user_id !== me);
  if (g.status !== "open" || g.my_status === "done") {
    if (g.mode === "duel" && g.status !== "open") {
      const o = others[0];
      return `Du ${mine?.score ?? 0} : ${o?.score ?? 0} ${o?.display_name ?? ""}`;
    }
    if (g.mode === "challenge") {
      const done = g.players.filter((p) => p.status === "done").length;
      return g.status === "open" ? `${done} von ${g.players.length} haben gespielt` : `Beendet · ${mine?.score ?? 0} von 5 richtig`;
    }
    if (g.status === "open") {
      const pending = others.filter((p) => p.status === "pending").map((p) => p.display_name);
      return `Wartet auf ${pending.join(", ")}`;
    }
  }
  if (g.my_turn) return g.mode === "duel" && g.created_by !== me ? "Du wurdest herausgefordert" : "Deine 5 Fragen warten";
  return `Wartet auf ${g.players.find((p) => p.user_id === g.created_by)?.display_name ?? "den Start"}`;
}

export function GameCard({ game, onChanged }: { game: GameListItem; onChanged?: () => void }) {
  const { profile } = useAuth();
  const me = profile!.id;
  const [busy, setBusy] = useState(false);

  let outcome: "win" | "loss" | "draw" | null = null;
  if (game.mode === "duel" && game.status !== "open") {
    const a = game.players.find((p) => p.user_id === me);
    const b = game.players.find((p) => p.user_id !== me);
    const diff = (a?.score ?? 0) - (b?.score ?? 0) || (b?.total_ms ?? 0) - (a?.total_ms ?? 0);
    outcome = diff > 0 ? "win" : diff < 0 ? "loss" : "draw";
  }

  async function nudge(e: MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try {
      await rpc("nudge", { p_game_id: game.id });
      toast("Angestupst!");
      onChanged?.();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={`game-card${game.my_turn ? " is-turn" : ""}`}
      onClick={() => navigate(`/spiel/${game.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/spiel/${game.id}`)}
    >
      <div className="game-card-main">
        <p className="game-card-mode">{modeLabel[game.mode]}</p>
        <h3>{title(game, me)}</h3>
        <p className="game-card-status">
          {outcome === "win" && <strong className="good">Gewonnen · </strong>}
          {outcome === "loss" && <strong className="bad">Verloren · </strong>}
          {outcome === "draw" && <strong>Unentschieden · </strong>}
          {statusLine(game, me)}
        </p>
      </div>
      <div className="game-card-side">
        {game.my_turn ? (
          <span className="pill pill-brass">Spielen</span>
        ) : game.can_nudge ? (
          <button className="btn btn-small btn-ghost" onClick={nudge} disabled={busy}>
            Anstupsen
          </button>
        ) : (
          <span className="muted small">{timeAgo(game.finished_at ?? game.created_at)}</span>
        )}
      </div>
    </article>
  );
}
