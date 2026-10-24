// Loaded before the stylesheet paints: sets the light base at once, so a light
// theme does not flash dark while the app starts. js/ui/theme.js does the rest.
(function () {
  try {
    var t = (JSON.parse(localStorage.getItem('gymSettings') || '{}') || {}).theme || {};
    var light = t.base === 'light' || (t.base === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    if (light) document.documentElement.setAttribute('data-theme', 'light');
  } catch { /* defaults to dark */ }
})();
