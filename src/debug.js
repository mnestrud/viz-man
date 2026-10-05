// On-screen diagnostics. The TV has no reachable console in this workflow, so
// errors and state are drawn on the panel and handed to the test link.

const MAX_ERRORS = 5;
const REFRESH_MS = 500;

export function createDebug(element, collect) {
  const errors = [];
  let timer = 0;

  function record(text) {
    errors.push(text);
    if (errors.length > MAX_ERRORS) errors.shift();
  }

  window.addEventListener("error", (event) => {
    record(event.message + (event.filename ? " @" + event.filename.split("/").pop() + ":" + event.lineno : ""));
  });
  window.addEventListener("unhandledrejection", (event) => {
    record("unhandled: " + (event.reason && event.reason.message ? event.reason.message : String(event.reason)));
  });

  function status() {
    const fields = collect();
    fields.errors = errors.slice();
    return fields;
  }

  function render() {
    const fields = status();
    const lines = [];
    for (const key of Object.keys(fields)) {
      if (key === "errors") continue;
      lines.push(key + ": " + fields[key]);
    }
    for (const error of fields.errors) lines.push("! " + error);
    element.textContent = lines.join("\n");
  }

  return {
    status,
    record,
    get visible() {
      return timer !== 0;
    },
    show(on) {
      if (on === (timer !== 0)) return;
      element.style.display = on ? "block" : "none";
      if (on) {
        render();
        timer = setInterval(render, REFRESH_MS);
      } else {
        clearInterval(timer);
        timer = 0;
      }
    },
  };
}
