// A shared browser-like fetch. Platforms serve very different HTML to
// non-browser User-Agents (or 403 outright), so a real browser UA is the
// baseline for every extractor.
//
// We also expose fetchAsBrowserWithCookies which returns the response
// body PLUS every Set-Cookie the platform sent, so the download step
// can re-use them when hitting the platform CDN — many CDNs
// (TikTok/Akamai especially) reject requests that don't carry the
// session cookies established by the initial page load.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchAsBrowser(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await rawBrowserFetch(url, init);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res;
}

// Returns the response body as text plus a cookie header string
// (`name=val; name2=val2; ...`) built from every Set-Cookie the server
// sent. Doesn't parse cookie attributes — we just take the leading
// `name=val` of each, which is all the platform CDNs check for.
export async function fetchAsBrowserWithCookies(
  url: string,
  init: RequestInit = {},
): Promise<{ text: string; cookies: string }> {
  const res = await rawBrowserFetch(url, init);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const setCookies = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie")?.split(", ") ?? []);
  const cookies = setCookies
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .join("; ");
  const text = await res.text();
  return { text, cookies };
}

function rawBrowserFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", UA);
  if (!headers.has("accept")) {
    headers.set(
      "accept",
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    );
  }
  if (!headers.has("accept-language")) headers.set("accept-language", "en-US,en;q=0.9");
  return fetch(url, { ...init, headers, redirect: "follow" });
}
