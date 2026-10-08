import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useImageUrl, type Bucket } from "../lib/images";
import { SKINS, useSkin, type Skin } from "../lib/skin";

export function Page({ title, children, back }: { title: string; children: ReactNode; back?: () => void }) {
  useEffect(() => {
    document.title = `${title} · Obmanns Kinder`;
  }, [title]);
  return (
    <main className="page">
      <header className="page-head">
        {back && (
          <button className="icon-btn" onClick={back} aria-label="Zurück">
            <Icon name="back" />
          </button>
        )}
        <h1>{title}</h1>
        <SkinSwitch />
      </header>
      {children}
    </main>
  );
}

export function Loading({ text = "Lädt …" }: { text?: string }) {
  return (
    <p className="muted loading" role="status">
      {text}
    </p>
  );
}

export function ErrorBox({ error, retry }: { error: string | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <p>{error}</p>
      {retry && (
        <button className="btn btn-small" onClick={retry}>
          Nochmal versuchen
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function StoredImage({ bucket, path, alt }: { bucket: Bucket; path: string | null; alt: string }) {
  const url = useImageUrl(bucket, path);
  if (!path) return null;
  return url ? <img className="stored-image" src={url} alt={alt} loading="lazy" /> : <div className="stored-image placeholder" />;
}

/** Bild auswählen mit Vorschau. */
export function ImagePicker({
  file,
  onChange,
  existingUrl,
  onRemoveExisting,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  existingUrl?: string | null;
  onRemoveExisting?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const shown = preview ?? existingUrl ?? null;
  return (
    <div className="image-picker">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && f.type.startsWith("video/")) return;
          onChange(f);
          e.target.value = "";
        }}
      />
      {shown ? (
        <div className="image-preview">
          <img src={shown} alt="Ausgewähltes Bild" />
          <button
            type="button"
            className="icon-btn image-remove"
            aria-label="Bild entfernen"
            onClick={() => (preview ? onChange(null) : onRemoveExisting?.())}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()}>
          <Icon name="image" size={18} /> Bild hinzufügen
        </button>
      )}
    </div>
  );
}

// Kleine Rückmeldungen unten am Bildschirm
type ToastMsg = { id: number; text: string };
let pushToast: (text: string) => void = () => {};
export function toast(text: string) {
  pushToast(text);
}
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    pushToast = (text) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, text }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3200);
    };
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Aufklappbarer Abschnitt. Merkt sich pro Gerät, ob er offen war. */
export function Fold({ id, title, badge, children }: { id: string; title: string; badge?: ReactNode; children: ReactNode }) {
  const key = `obmanns-fold-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  return (
    <details
      className="fold"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        try {
          localStorage.setItem(key, o ? "1" : "0");
        } catch {
          /* privater Modus */
        }
      }}
    >
      <summary>
        <h2>{title}</h2>
        {badge}
        <svg className="fold-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/** Design wählen (pro Gerät): Klassisch, Rätselheft, Pop Art */
export function SkinSwitch() {
  const [skin, setSkin] = useSkin();
  return (
    <label className="skin-switch" title="Design wählen">
      <b aria-hidden="true">Aa</b>
      <select value={skin} onChange={(e) => setSkin(e.target.value as Skin)} aria-label="Design wählen">
        {SKINS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
