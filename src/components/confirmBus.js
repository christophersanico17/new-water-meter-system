// Replaces window.confirm() with an in-app dialog. ConfirmDialog (mounted once
// in WaterSystemPrototype) listens for requests and settles the promise with
// true (OK) or false (Cancel / click outside).
const listeners = new Set();

export function subscribeConfirm(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function askConfirm(message) {
  return new Promise((resolve) => {
    if (listeners.size === 0) return resolve(false);
    listeners.forEach((fn) => fn({ message, resolve }));
  });
}
