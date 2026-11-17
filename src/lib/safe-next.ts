// Where to go after sign-in (?next=…): only a path on this site. Rejects other sites ("//evil.com"),
// backslash tricks ("/\evil.com", which browsers read as "//evil.com"), and control characters.
export function safeNext(next: string | null | undefined, fallback = "/campaigns"): string {
  if (!next || next.length > 500) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
