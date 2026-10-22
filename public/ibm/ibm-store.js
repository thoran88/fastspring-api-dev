// All IBM demo pages run against the tariqh store. This wraps fetch so every
// /api call carries X-FS-Store: tariqh, which the server's storeMiddleware
// uses to pick tariqh's credentials and API host instead of the thoran default.
export const IBM_STORE = "tariqh";

export function ibmFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "X-FS-Store": IBM_STORE },
  });
}
