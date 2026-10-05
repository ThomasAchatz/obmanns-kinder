import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, supabase } from "./supabase";
import type { Category, Profile } from "./types";

/** Lädt Daten, liefert { data, error, loading, reload }. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loaderRef.current());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}

let categoryCache: Category[] | null = null;
export function useCategories() {
  return useLoad(async () => {
    if (categoryCache) return categoryCache;
    const { data, error } = await supabase.from("categories").select("id, name, icon, sort_order").order("sort_order");
    if (error) throw error;
    categoryCache = data as Category[];
    return categoryCache;
  });
}
export function clearCategoryCache() {
  categoryCache = null;
}

export function usePlayers() {
  return useLoad(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_path, is_admin")
      .order("display_name");
    if (error) throw error;
    return data as Profile[];
  });
}

/** Aktualisiert, wenn die App wieder in den Vordergrund kommt. */
export function useOnVisible(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
}
