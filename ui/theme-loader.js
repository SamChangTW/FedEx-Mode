// TSAA Theme Loader v1.1
// Applies CSS variables based on the active Scheduler theme.
(function () {
  const THEME_FILE = 'ui/tsaa_theme.json';
  const DEFAULT_THEME_KEY = 'scheduler'; // activate scheduler theme by default

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const map = {
      '--tsaa-color-primary': theme['color-primary'],
      '--tsaa-color-secondary': theme['color-secondary'],
      '--tsaa-color-bg': theme['color-background'],
      '--tsaa-color-surface': theme['color-surface'],
      '--tsaa-color-border': theme['color-border'],
      '--tsaa-color-text': theme['color-text'],
      '--tsaa-color-accent': theme['color-accent'],
    };
    Object.entries(map).forEach(([k, v]) => {
      if (v) root.style.setProperty(k, v);
    });
  }

  function resolveThemeKeyFromBody() {
    const body = document.body;
    if (!body) return DEFAULT_THEME_KEY;
    // Accept either theme-scheduler or theme-scheduler_midnight_blue
    const classes = Array.from(body.classList);
    const c = classes.find(cls => cls.startsWith('theme-'));
    if (!c) return DEFAULT_THEME_KEY;
    const key = c.replace('theme-', '').trim();
    // Map theme-scheduler to scheduler key, otherwise use value directly
    return key || DEFAULT_THEME_KEY;
  }

  async function init() {
    try {
      const res = await fetch(THEME_FILE, { cache: 'no-store' });
      const allThemes = await res.json();
      const key = resolveThemeKeyFromBody();
      const theme = allThemes[key] || allThemes[DEFAULT_THEME_KEY] || allThemes['scheduler_midnight_blue'];
      applyTheme(theme);
    } catch (err) {
      // Fail silently to respect instruction not to change logic; keep default tokens
      console.warn('[TSAA] Failed to load theme:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
