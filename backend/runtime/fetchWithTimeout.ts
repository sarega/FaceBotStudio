const DEFAULT_EXTERNAL_REQUEST_TIMEOUT_MS = 15_000;

function normalizeTimeoutMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_EXTERNAL_REQUEST_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1_000, Math.floor(value)));
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_EXTERNAL_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }

  timeoutHandle = setTimeout(() => controller.abort(new Error("External request timed out")), normalizeTimeoutMs(timeoutMs));
  try {
    return await fetch(input, {
      ...(init || {}),
      signal: controller.signal,
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}
