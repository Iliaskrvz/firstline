// "Unused credits refunded within 30 days of purchase": built but OFF until the owner (and their
// lawyer) decide. REFUND_OFFER=1 shows the line next to pricing and adds the clause to the terms.
// Dodo Payments handles the refund itself; the owner then takes the unused credits back.
export const refundOffer = (env: Record<string, string | undefined> = process.env) => env.REFUND_OFFER?.trim() === "1";

export const REFUND_TERMS_CLAUSE =
  "Unused credits from a purchase can be refunded within 30 days of that purchase. Ask us by email; we refund the unused credits of that pack at the price you paid, through our payment provider, and remove them from your balance. Credits already used are not refunded.";
