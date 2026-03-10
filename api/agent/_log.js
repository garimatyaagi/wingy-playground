export default function makeLogger(module) {
  return {
    info: (event, data = {}) =>
      console.log(JSON.stringify({ level: "info", module, event, ...data, ts: Date.now() })),
    warn: (event, data = {}) =>
      console.warn(JSON.stringify({ level: "warn", module, event, ...data, ts: Date.now() })),
    error: (event, data = {}) =>
      console.error(JSON.stringify({ level: "error", module, event, ...data, ts: Date.now() })),
  };
}
