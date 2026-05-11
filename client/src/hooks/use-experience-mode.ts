import { useEffect, useState } from "react";

export type ExperienceMode = "beginner" | "advanced";

const STORAGE_KEY = "experience_mode";

function readInitial(): ExperienceMode {
  if (typeof window === "undefined") return "beginner";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "advanced" ? "advanced" : "beginner";
  } catch {
    return "beginner";
  }
}

export function useExperienceMode(): [ExperienceMode, (m: ExperienceMode) => void] {
  const [mode, setMode] = useState<ExperienceMode>(readInitial);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setMode(readInitial());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const set = (m: ExperienceMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, m);
    } catch {}
    setMode(m);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  };

  return [mode, set];
}
