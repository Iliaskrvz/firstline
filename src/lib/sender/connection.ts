// The Sender Sheet connection code: "FL1.<address, base64url>.<key>". Runs in the browser (setup steps)
// and on the server, so no Node-only APIs (Buffer, node:crypto) here.

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64: string): string {
  let s = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** One paste for the sheet. The script stays the same for everyone; when the address changes, only this code does. */
export function connectionCode(appUrl: string, key: string): string {
  return `FL1.${toBase64Url(appUrl.trim().replace(/\/+$/, ""))}.${key.trim()}`;
}

export function parseConnectionCode(code: string): { base: string; key: string } | null {
  const m = /^FL1\.([A-Za-z0-9_-]+)\.(fl_[A-Za-z0-9_-]{40,})$/.exec(code.trim());
  if (!m) return null;
  try {
    return { base: fromBase64Url(m[1]), key: m[2] };
  } catch {
    return null;
  }
}
