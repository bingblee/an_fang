export type Theme = "light" | "dark";
export const themeStorageKey = "anfang-theme";
export const themeColors = { light: "#f6f7f2", dark: "#080d18" } as const;

// Runs in the document head before the first paint. Only a validated, local
// preference changes the theme; no personal records or server settings are read.
export const themeInitScript = `(function(){
  var theme = 'light';
  try { if (localStorage.getItem('${themeStorageKey}') === 'dark') theme = 'dark'; } catch (_) {}
  document.documentElement.dataset.theme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '${themeColors.dark}' : '${themeColors.light}');
})();`;
