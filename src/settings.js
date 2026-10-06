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

// Preferences live in localStorage, which webOS may wipe on an app update and
// which can be unavailable altogether, so they are also kept in memory here
// and mirrored to the Music Assistant user account (see follow.js).
const PREFIX = "vis.";
const memory = {};
let changeListener = null;

function stored(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch (e) {
    return undefined;
  }
}

function store(key, value) {
  memory[key] = value;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    // nothing to do: localStorage is a convenience
  }
}

export function loadPref(key, fallback) {
  const value = stored(key);
  if (value !== undefined) return value;
  return key in memory ? memory[key] : fallback;
}

export function savePref(key, value) {
  store(key, value);
  if (changeListener) changeListener(allPrefs());
}

export function hasPref(key) {
  return stored(key) !== undefined || key in memory;
}

// Every preference held locally.
export function allPrefs() {
  const all = Object.assign({}, memory);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name.indexOf(PREFIX) === 0) all[name.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(name));
    }
  } catch (e) {
    // memory copy only
  }
  return all;
}

export function onPrefChange(fn) {
  changeListener = fn;
}

// Preferences shared by every TV on the account; the rest are per device.
export const SHARED_PREFS = ["favourites"];

// Overwrite preferences from a copy kept elsewhere, without counting it as a
// local change.
export function takePrefs(values) {
  for (const key of Object.keys(values || {})) store(key, values[key]);
}

// Take over the preferences from a copy kept elsewhere, for the keys this
// device has no value of its own for (a fresh install, say). Returns the keys
// that were taken.
export function mergePrefs(remote) {
  const taken = [];
  for (const key of Object.keys(remote || {})) {
    if (hasPref(key)) continue;
    store(key, remote[key]);
    taken.push(key);
  }
  return taken;
}
