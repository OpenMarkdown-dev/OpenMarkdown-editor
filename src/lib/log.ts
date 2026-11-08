/**
 * The developer log — the ONE place the frontend writes `console.error`
 * (change: feedback; spec: app-feedback / 每个后端调用声明错误策略). Everything
 * the user does not need to see but a developer must be able to find lands
 * here: a background probe that failed, a best-effort push, an unhandled
 * rejection. `check-app-surface.mjs` (`console-outside-log`) fails on any other
 * `console.error` / `console.warn` in `src/`.
 *
 * Not a user channel. What the user must see goes through `notify`.
 */
export function logError(context: string, error: unknown): void {
  console.error(`[openmd] ${context}:`, error);
}

let installed = false;

/**
 * The backstop (design D4): a rejection that no boundary caught is logged
 * instead of vanishing. It does not notify — an uncaught rejection is a bug,
 * and the sentence a user would get from it is not one they can act on. Its
 * job is "never silent", not "always shown".
 */
export function installErrorNet(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("unhandledrejection", (e) => logError("unhandled rejection", e.reason));
}
