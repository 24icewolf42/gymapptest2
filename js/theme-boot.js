// Loaded before the stylesheet paints: sets the light base at once, so a light
// theme does not flash dark while the app starts. js/ui/theme.js does the rest.
(function () {
  try {
    // From the iPhone home screen the status bar is drawn over the page
    // (black-translucent): css/app.css keeps it readable in the light theme.
    if (window.navigator.standalone === true) document.documentElement.classList.add('ios-standalone');
    var t = (JSON.parse(localStorage.getItem('gymSettings') || '{}') || {}).theme || {};
    var light = t.base === 'light' || (t.base === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    if (light) {
      document.documentElement.setAttribute('data-theme', 'light');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#f5f6f8'); // the light --bg (css/app.css)
    }
  } catch { /* defaults to dark */ }
})();
