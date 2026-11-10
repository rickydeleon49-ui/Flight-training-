/* Applies the saved colour theme before first paint. Keep in step with src/lib/theme.ts. */
(function () {
  try {
    var ua = navigator.userAgent || "";
    var touch = navigator.maxTouchPoints || 0;
    if (/iPhone|iPad|iPod/.test(ua) || (ua.indexOf("Macintosh") !== -1 && touch > 1)) return;
    var theme = "light";
    try {
      var raw = localStorage.getItem("her-flight-deck.theme");
      if (raw) {
        var v = raw;
        try { v = JSON.parse(raw); } catch (e) {}
        if (v !== "light" && v !== "light-grey" && v !== "dark" && v !== "auto") v = raw;
        if (v === "light" || v === "light-grey" || v === "dark" || v === "auto") theme = v;
      }
    } catch (e) {}
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
