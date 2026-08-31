"use client";

import { Moon, SunMedium } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { themeColors, themeStorageKey, type Theme } from "@/lib/theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[theme]);
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    applyTheme(event.newValue === "dark" ? "dark" : "light");
    onChange();
  };
  window.addEventListener("anfang-theme-change", onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("anfang-theme-change", onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe,
    () => document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    () => "light");

  useEffect(() => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(themeStorageKey, next); } catch { /* Theme still works when storage is unavailable. */ }
    window.dispatchEvent(new Event("anfang-theme-change"));
  };

  return <button type="button" className="theme-toggle" onClick={toggle}
    aria-label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
    title={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}>
    {theme === "dark" ? <SunMedium size={17} /> : <Moon size={17} />}
  </button>;
}
