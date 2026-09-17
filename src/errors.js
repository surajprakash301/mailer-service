export function logError(context, err) {
  const message = err?.message || String(err);
  const status = err?.status ? ` status=${err.status}` : "";
  console.error(`[error] ${context}${status}: ${message}`);
}
