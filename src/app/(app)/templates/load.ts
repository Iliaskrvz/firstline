import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leadVars } from "@/components/template-preview";
import { availableVariables } from "@/lib/csv";
import type { CampaignRow, LeadRow } from "@/lib/types";

/** Variables + a sample lead for the editor preview, from the given or latest campaign. */
export async function previewContext(supabase: SupabaseClient, campaignId: string | null) {
  let q = supabase.from("campaigns").select("id, name, column_map").eq("source", "app");
  q = campaignId ? q.eq("id", campaignId) : q.order("created_at", { ascending: false });
  const { data: campaign } = await q.limit(1).maybeSingle();
  if (!campaign) return { campaignName: null, variables: null, sample: null };

  const { data: lead } = await supabase
    .from("leads")
    .select("email, first_name, last_name, company, title, linkedin_headline, website, domain, custom")
    .eq("campaign_id", campaign.id)
    .not("first_name", "is", null)
    .limit(1)
    .maybeSingle();

  return {
    campaignName: (campaign as CampaignRow).name,
    variables: availableVariables((campaign as CampaignRow).column_map),
    sample: lead ? leadVars(lead as Omit<LeadRow, "id" | "status">) : null,
  };
}
