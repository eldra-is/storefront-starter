import { appendResponseHeader } from 'h3';

/**
 * `onResponse` for a fetch the server render makes to this site's own routes: passes the route's
 * `Set-Cookie` headers on to the browser, so a session the route refreshed (a longer cookie) or
 * ended (a deleted cookie) reaches it. A no-op in the browser, which sees the headers itself.
 */
export function useForwardCookies() {
  const event = import.meta.server ? useRequestEvent() : undefined;
  return ({ response }: { response: Response }) => {
    if (!event) return;
    for (const cookie of response.headers.getSetCookie()) {
      appendResponseHeader(event, 'set-cookie', cookie);
    }
  };
}

/** `useRequestFetch()` (the session cookie forwarded on the server) that also forwards `Set-Cookie` back. */
export function useServerFetch() {
  const fetch = useRequestFetch() as typeof $fetch;
  const onResponse = useForwardCookies();
  return <T>(request: string, options: { query?: Record<string, unknown> } = {}): Promise<T> =>
    fetch<T>(request, { ...options, onResponse }) as Promise<T>;
}
