import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Bucket = "question-images" | "fact-images";

/** Verkleinert ein Bild auf max. 1200 px und speichert es als WebP (GIFs bleiben unverändert). */
export async function compressImage(file: File, maxSize = 1200, quality = 0.82): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  if (blob && blob.type === "image/webp") return blob;
  // Safari kann teils kein WebP schreiben → JPEG
  const jpeg = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!jpeg) throw new Error("Bild konnte nicht verarbeitet werden.");
  return jpeg;
}

export async function uploadImage(bucket: Bucket, userId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Bitte wähle ein Bild aus.");
  if (file.type.startsWith("video/")) throw new Error("Videos sind nicht erlaubt.");
  const blob = await compressImage(file);
  if (blob.size > 3 * 1024 * 1024) throw new Error("Das Bild ist zu groß (max. 3 MB).");
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function deleteImage(bucket: Bucket, path: string | null) {
  if (path) await supabase.storage.from(bucket).remove([path]);
}

// Signierte URLs zwischenspeichern (gültig 1 Stunde, nach 50 Minuten neu holen)
const cache = new Map<string, { url: string; until: number }>();

export function useImageUrl(bucket: Bucket, path: string | null | undefined): string | null {
  const key = path ? `${bucket}/${path}` : "";
  const cached = key ? cache.get(key) : undefined;
  const [url, setUrl] = useState<string | null>(cached && cached.until > Date.now() ? cached.url : null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) {
      setUrl(hit.url);
      return;
    }
    let alive = true;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        cache.set(key, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [bucket, path, key]);

  return url;
}
