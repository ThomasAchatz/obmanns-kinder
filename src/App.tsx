import { useEffect, useState } from "react";
import { useAuth } from "./lib/auth";
import { match, navigate, useRoute } from "./lib/router";
import { isConfigured } from "./lib/supabase";
import { Icon, type IconName } from "./components/Icon";
import { Loading, Toaster } from "./components/ui";
import { LoginPage } from "./pages/Login";
import { HomePage } from "./pages/Home";
import { PlayPage } from "./pages/Play";
import { GamePage } from "./pages/Game";
import { MusicGamePage } from "./pages/MusicGame";
import { BildGamePage } from "./pages/BildGame";
import { SongAddPage } from "./pages/SongAdd";
import { QuestionsPage } from "./pages/Questions";
import { QuestionFormPage } from "./pages/QuestionForm";
import { FactsPage } from "./pages/Facts";
import { ProfilePage } from "./pages/Profile";
import { AdminPage } from "./pages/Admin";

const tabs: { path: string; label: string; icon: IconName }[] = [
  { path: "/", label: "Start", icon: "home" },
  { path: "/spielen", label: "Spielen", icon: "play" },
  { path: "/fragen", label: "Fragen", icon: "write" },
  { path: "/wissen", label: "Wissen", icon: "bulb" },
  { path: "/profil", label: "Profil", icon: "user" },
];

function activeTab(route: string) {
  if (route.startsWith("/spiel") || route.startsWith("/musik") || route.startsWith("/bilder")) return "/spielen";
  if (route.startsWith("/fragen") || route.startsWith("/songs")) return "/fragen";
  if (route.startsWith("/admin")) return "/profil";
  return tabs.find((t) => t.path !== "/" && route.startsWith(t.path))?.path ?? "/";
}

function Routes({ route }: { route: string }) {
  let p: Record<string, string> | null;
  if ((p = match("/spiel/:id", route))) return <GamePage id={Number(p.id)} key={p.id} />;
  if ((p = match("/musik/:id", route))) return <MusicGamePage id={Number(p.id)} key={p.id} />;
  if ((p = match("/bilder/:id", route))) return <BildGamePage id={Number(p.id)} key={p.id} />;
  if (match("/songs/neu", route)) return <SongAddPage />;
  if (match("/spielen", route)) return <PlayPage />;
  if (match("/fragen", route)) return <QuestionsPage />;
  if (match("/fragen/neu", route)) return <QuestionFormPage />;
  if ((p = match("/fragen/:id", route))) return <QuestionFormPage id={Number(p.id)} key={p.id} />;
  if (match("/wissen", route)) return <FactsPage />;
  if (match("/profil", route)) return <ProfilePage />;
  if (match("/admin", route)) return <AdminPage />;
  return <HomePage />;
}

function useServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    });
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
        });
      });
      // Beim Zurückkehren in die App nach Updates schauen
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    });
  }, []);
  return waiting;
}

export function App() {
  const { loading, session, profile } = useAuth();
  const route = useRoute();
  const waiting = useServiceWorker();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (!isConfigured) {
    return (
      <main className="page">
        <h1>Noch nicht eingerichtet</h1>
        <p>
          Es fehlen <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code>. Trag sie als Repository-Variablen auf GitHub
          ein und starte das Deployment neu (siehe SETUP.md).
        </p>
      </main>
    );
  }

  if (loading) return <Loading text="Obmanns Kinder lädt …" />;
  if (!session) return <LoginPage />;
  if (!profile) return <Loading text="Profil wird geladen …" />;

  const inGame = route.startsWith("/spiel/") || route.startsWith("/musik/") || route.startsWith("/bilder/");
  const current = activeTab(route);

  return (
    <div className={inGame ? "shell shell-game" : "shell"}>
      {waiting && (
        <div className="update-banner" role="status">
          <span>Eine neue Version ist da.</span>
          <button className="btn btn-small btn-brass" onClick={() => waiting.postMessage("SKIP_WAITING")}>
            Jetzt aktualisieren
          </button>
        </div>
      )}
      <Routes route={route} />
      {!inGame && (
        <nav className="tabbar" aria-label="Hauptnavigation">
          {tabs.map((t) => (
            <a
              key={t.path}
              href={`#${t.path}`}
              className={current === t.path ? "tab active" : "tab"}
              aria-current={current === t.path ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(t.path);
              }}
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </a>
          ))}
        </nav>
      )}
      <Toaster />
    </div>
  );
}
