import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "dark" | "light" | "auto";
type ResolvedTheme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "vcp-theme";

function isDaytimeNow(): boolean {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18;
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "auto") return isDaytimeNow() ? "light" : "dark";
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "dark" || stored === "light" || stored === "auto") return stored;
    }
    return "auto";
  });

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(theme));

  useEffect(() => {
    setResolvedTheme(resolve(theme));
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (theme !== "auto") return;
    const tick = () => setResolvedTheme(resolve(theme));
    tick();
    const id = window.setInterval(tick, 5 * 60 * 1000);
    const onVisibility = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [theme]);

  const value = useMemo<ThemeContextType>(() => ({
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme: () =>
      setTheme((prev) => (prev === "dark" ? "light" : prev === "light" ? "auto" : "dark")),
  }), [theme, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
