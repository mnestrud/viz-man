// Settings come from three places, later ones winning: the build-time config
// (window.VIS_CONFIG), webOS launch parameters, and the page's query string.

const BOOLEANS = ["holdWhenIdle", "mock", "debug", "noWebgl"];

export function parseQuery(search) {
  const out = {};
  const text = (search || "").replace(/^\?/, "");
  if (!text) return out;
  for (const part of text.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
    out[key] = eq < 0 ? "1" : decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}

// webOS hands launch parameters over as an object or as a JSON string,
// depending on the firmware and on where they are read from.
export function normalizeParams(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function mergeSettings(config, launch, query, origin) {
  const merged = Object.assign({ host: "", token: "", player: "", report: "" }, config, launch, query);
  for (const key of BOOLEANS) merged[key] = toBoolean(merged[key]);
  // ?report=1 means "report to the server this page came from".
  if (toBoolean(merged.report)) merged.report = origin || "";
  merged.report = String(merged.report || "").replace(/\/+$/, "");
  return merged;
}

export function readLaunchParams(win, event) {
  const fromEvent = normalizeParams(event && event.detail);
  if (Object.keys(fromEvent).length) return fromEvent;
  const fromWindow = normalizeParams(win.launchParams);
  if (Object.keys(fromWindow).length) return fromWindow;
  const system = win.webOSSystem || win.PalmSystem;
  return normalizeParams(system && system.launchParams);
}

// Preferences are a convenience only: webOS deletes localStorage on every app
// update, and it can be unavailable altogether.
export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem("vis." + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem("vis." + key, JSON.stringify(value));
  } catch (e) {
    // nothing to do: preferences are best-effort
  }
}
