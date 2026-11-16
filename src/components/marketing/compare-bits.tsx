// Small pieces shared by /compare, /compare/[tool] and /calculator.
import { COMPARE } from "@/content/compare";
import { checkedOnLabel, type Competitor } from "@/content/competitors";
import { fmtEuro } from "@/content/site";
import type { CompetitorCost, FirstLineCost } from "@/lib/price-compare";

export function CompetitorCostText({ cost }: { cost: CompetitorCost }) {
  if (cost.kind === "unknown") return <span className="text-slate-500">{COMPARE.unknown[cost.why]}</span>;
  if (cost.kind === "price")
    return (
      <span>
        <span className="font-semibold text-slate-900">
          {cost.currency}
          {cost.price}
        </span>
        {COMPARE.perMonth} <span className="block text-xs text-slate-500">{cost.plan}</span>
      </span>
    );
  return (
    <span>
      <span className="font-semibold text-slate-900">{COMPARE.rangeLabel(`${cost.currency}${cost.low.price}`, `${cost.currency}${cost.high.price}`)}</span>
      {COMPARE.perMonth}
      <span className="block text-xs text-slate-500">
        {COMPARE.rangePlans(cost.low.plan, cost.high.plan)}
      </span>
    </span>
  );
}

export function FirstLineCostText({ cost }: { cost: FirstLineCost }) {
  return (
    <span>
      <span className="font-semibold text-slate-900">{fmtEuro(cost.monthly, "en")}</span>
      {COMPARE.perMonth}
      <span className="block text-xs text-slate-500">
        {COMPARE.perEmailPack(fmtEuro(cost.perEmail, "en", 3), cost.pack.name)}
      </span>
    </span>
  );
}

/** The sources list: every competitor's pricing page, what the numbers assume, and the date checked. */
export function CompareSources({ list }: { list: Competitor[] }) {
  return (
    <div className="text-sm text-slate-600">
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.id}>
            <a href={c.source} target="_blank" rel="noopener nofollow" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
              {COMPARE.pricingLink(c.name)}
            </a>
            : {c.notes}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-slate-500">{COMPARE.checkedOn(checkedOnLabel())}</p>
    </div>
  );
}
