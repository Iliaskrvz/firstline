// Credit packs (§9, Phase 10). Edit here, not in the pages. Prices in euro cents excl. VAT.
// enabled: shown and buyable. Proposed packs stay off until the owner approves them and the matching
// Kelviq plan exists (Kelviq plan id: firstline-<id>, or KELVIQ_PLAN_<ID> in .env.local).
// PACKS_ENABLED=starter,growth,agency,scale-50k in .env.local overrides "enabled" without a code change.
//
// Lite credits (kind "lite") only pay for campaigns with the Lite writer (Haiku writes, 2 pages read);
// standard credits pay for both. Pricing rule (§9): price ≈ real cost × 3; volume packs above
// 50,000 credits ≈ × 2.5. Real-cost estimates behind the proposals: docs/V1.5-PLAN.md (Phase 10).

export type PackKind = "standard" | "lite";
export type Pack = { id: string; name: string; credits: number; priceCents: number; kind: PackKind; enabled: boolean; proposed?: boolean };

export const PACK_CONFIG: Pack[] = [
  { id: "starter", name: "Starter", credits: 500, priceCents: 1900, kind: "standard", enabled: true },
  { id: "growth", name: "Growth", credits: 2_000, priceCents: 6900, kind: "standard", enabled: true },
  { id: "agency", name: "Agency", credits: 10_000, priceCents: 29_900, kind: "standard", enabled: true },
  // Proposed (Phase 10), not on sale yet. Estimated real cost (no real Claude runs yet): Pro ≈ €0.013,
  // Lite ≈ €0.0045 per email. ×2.5 on Pro would cost more per credit than Agency (×2.3 today), so Scale is
  // priced just below Agency (×2.2 / ×2.1; ×3 when run in Economy mode). Lite: ×3 small, ×2.5 volume. See docs/V1.5-PLAN.md.
  { id: "scale-50k", name: "Scale", credits: 50_000, priceCents: 145_000, kind: "standard", enabled: false, proposed: true },
  { id: "scale-100k", name: "Scale 100k", credits: 100_000, priceCents: 270_000, kind: "standard", enabled: false, proposed: true },
  { id: "lite-10k", name: "Lite 10k", credits: 10_000, priceCents: 13_900, kind: "lite", enabled: false, proposed: true },
  { id: "lite-50k", name: "Lite 50k", credits: 50_000, priceCents: 56_900, kind: "lite", enabled: false, proposed: true },
  { id: "lite-100k", name: "Lite 100k", credits: 100_000, priceCents: 109_900, kind: "lite", enabled: false, proposed: true },
];
