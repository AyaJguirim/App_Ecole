// Appliqué avant l'affichage (évite le flash) : thème enregistré, sinon préférence du système.
(function () {
  var t = null; try { t = localStorage.getItem('theme'); } catch (e) {}
  if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
