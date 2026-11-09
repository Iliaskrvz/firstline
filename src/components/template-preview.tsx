import { Fragment } from "react";
import type { Token } from "@/lib/template";

/** Renders template tokens: variables filled (or flagged), slots as highlighted chips. */
export function TokenPreview({ tokens, vars }: { tokens: Token[]; vars: Record<string, string | null | undefined> }) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "text") return <Fragment key={i}>{t.value}</Fragment>;
        if (t.type === "var") {
          const v = vars[t.key];
          return v ? (
            <span key={i} className="tok-var" title={`{{${t.key}}}`}>
              {v}
            </span>
          ) : (
            <span key={i} className="tok-var opacity-60" title="Empty for this lead">
              {`{{${t.key}}}`}
            </span>
          );
        }
        return (
          <span key={i} className="tok-slot" title="Written by FirstLine for each lead">
            ✦ {t.key}
          </span>
        );
      })}
    </>
  );
}

export function leadVars(lead: {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  linkedin_headline: string | null;
  website: string | null;
  domain: string | null;
  custom: Record<string, string> | null;
}): Record<string, string | null> {
  const { custom, ...rest } = lead;
  return { ...(custom ?? {}), ...rest };
}
