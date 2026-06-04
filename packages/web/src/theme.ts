export type Theme = 'light' | 'dark';

/** Aktuell gesetztes Theme (vom Init-Skript in index.html vorbelegt). */
export function aktuellesTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Setzt das Theme und merkt es sich für künftige Besuche. */
export function setzeTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* localStorage evtl. blockiert — dann gilt das Theme nur für diese Sitzung. */
  }
}
