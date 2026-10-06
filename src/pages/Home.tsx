import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad, useOnVisible } from "../lib/hooks";
import { navigate } from "../lib/router";
import { rpc, supabase } from "../lib/supabase";
import { pushState, type PushState } from "../lib/push";
import type { Fact, GameListItem } from "../lib/types";
import { GameCard } from "../components/GameCard";
import { Empty, ErrorBox, Loading, Page, StoredImage } from "../components/ui";

export function HomePage() {
  const { profile } = useAuth();
  const games = useLoad(() => rpc<GameListItem[]>("my_games"));
  const fact = useLoad(async () => {
    const { data } = await supabase
      .from("facts")
      .select("id, author_id, text, image_path, created_at, author:profiles!facts_author_id_fkey(display_name), fact_likes(user_id)")
      .order("created_at", { ascending: false })
      .limit(1);
    return ((data ?? [])[0] as unknown as Fact) ?? null;
  });
  const [push, setPush] = useState<PushState | null>(null);
  useEffect(() => {
    pushState().then(setPush);
  }, []);
  useOnVisible(() => games.reload());

  const list = games.data ?? [];
  const myTurn = list.filter((g) => g.my_turn);
  const waiting = list.filter((g) => !g.my_turn && g.status === "open");
  const done = list.filter((g) => g.status !== "open").slice(0, 8);

  return (
    <Page title={`Servus, ${profile?.display_name}`}>
      {push === "off" && (
        <button className="notice" onClick={() => navigate("/profil")}>
          Schalte Benachrichtigungen ein, damit du merkst, wenn dich jemand herausfordert.
        </button>
      )}
      {push === "needs-install" && (
        <div className="notice">Für Benachrichtigungen auf dem iPhone: Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen.</div>
      )}

      <ErrorBox error={games.error} retry={games.reload} />
      {games.loading && !games.data ? (
        <Loading />
      ) : (
        <>
          <section className="section">
            <h2>Du bist dran</h2>
            {myTurn.length === 0 ? (
              <Empty>
                <p>Gerade wartet nichts auf dich.</p>
                <button className="btn btn-primary" onClick={() => navigate("/spielen")}>
                  Jemanden herausfordern
                </button>
              </Empty>
            ) : (
              <div className="stack">
                {myTurn.map((g) => (
                  <GameCard key={g.id} game={g} onChanged={games.reload} />
                ))}
              </div>
            )}
          </section>

          {waiting.length > 0 && (
            <section className="section">
              <h2>Wartet auf andere</h2>
              <div className="stack">
                {waiting.map((g) => (
                  <GameCard key={g.id} game={g} onChanged={games.reload} />
                ))}
              </div>
            </section>
          )}

          {fact.data && (
            <section className="section">
              <h2>Neu im unnützen Wissen</h2>
              <button className="fact-teaser" onClick={() => navigate("/wissen")}>
                {fact.data.text && <p>{fact.data.text}</p>}
                <StoredImage bucket="fact-images" path={fact.data.image_path} alt="Bild zum Fakt" />
                <span className="muted small">von {fact.data.author?.display_name}</span>
              </button>
            </section>
          )}

          {done.length > 0 && (
            <section className="section">
              <h2>Zuletzt beendet</h2>
              <div className="stack">
                {done.map((g) => (
                  <GameCard key={g.id} game={g} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </Page>
  );
}
