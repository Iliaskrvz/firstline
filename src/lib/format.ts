export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function n(v: number | undefined | null) {
  return new Intl.NumberFormat("en-GB").format(v ?? 0);
}

export const STATUS_TONE = { draft: "gray", preview: "indigo", running: "amber", done: "green", cancelled: "red" } as const;
