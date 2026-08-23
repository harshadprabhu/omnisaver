// A shared browser-like fetch. Platforms serve very different HTML to
// non-browser User-Agents (or 403 outright), so a real browser UA is the
// baseline for every extractor. Cookies aren't set — we only ever hit
// pages that render for a logged-out visitor.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchAsBrowser(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", UA);
  if (!headers.has("accept")) {
    headers.set(
      "accept",
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    );
  }
  if (!headers.has("accept-language")) headers.set("accept-language", "en-US,en;q=0.9");
  const res = await fetch(url, { ...init, headers, redirect: "follow" });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res;
}
