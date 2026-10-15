// Route handling for screenshot.mjs, kept separate so the checks in
// .claude/tests/setup-helpers.test.mjs can call it without a browser.
//
// The app uses HashRouter (src/App.tsx), so the server only ever serves `/`
// and the screen is chosen by the fragment: `/#/finances` is Finances, while
// `/finances` is the Flight Deck home page. Routes are therefore accepted in
// the documented form (`/finances`) and also as `/#/finances`, `#/finances`
// or `finances`, and always loaded as `BASE/#/finances`.

/**
 * Normalises one command-line route. Returns the app path (`/finances`), the
 * URL to load, and a file name that is safe on every platform (no `#`, `?`,
 * `/` or other punctuation). Throws on anything that is not an app route.
 */
export function routeTarget(route, base, { dark = false } = {}) {
  if (typeof route !== "string" || route.trim() === "") throw new Error("An empty route was given");
  let path = route.trim();
  if (/^[a-z]+:\/\//i.test(path)) {
    throw new Error(`Give a route such as /finances, not a full URL: ${route}`);
  }
  path = path.replace(/^\/?#/, ""); // `/#/x` and `#/x` → `/x`
  if (!path.startsWith("/")) path = "/" + path;
  if (path.includes("#")) throw new Error(`A route can hold only one #: ${route}`);
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";

  const stem =
    path
      .slice(1)
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "") || "home";
  return {
    path,
    url: `${base}/#${path}`,
    name: `${stem}${dark ? "-os-dark" : ""}.png`,
  };
}

/** Normalises every route and refuses two routes that would overwrite one file. */
export function routeTargets(routes, base, options) {
  const targets = routes.map((r) => routeTarget(r, base, options));
  const seen = new Map();
  routes.forEach((r, i) => {
    const { name } = targets[i];
    if (seen.has(name)) throw new Error(`Routes ${seen.get(name)} and ${r} would both be saved as ${name}`);
    seen.set(name, r);
  });
  return targets;
}

/**
 * Explains why the rendered page is not the requested route, or returns null.
 * `state` is read from the page: its location, whether the app shell's
 * <main> rendered, and whether the catch-all "not here" screen is showing.
 */
export function routeMismatch(target, state) {
  if (state.pathname !== "/") {
    return `loaded server path ${state.pathname}; the app only serves / and routes by #`;
  }
  const rendered = decodeURIComponent(state.hash.replace(/^#/, "")) || "/";
  if (rendered !== decodeURIComponent(target.path)) {
    return `the app is showing ${rendered}`;
  }
  if (!state.hasMain) return "the app shell did not render (still loading, or the data-recovery screen)";
  if (state.notFound) return "the app rendered its \"That page isn't here.\" screen";
  return null;
}
