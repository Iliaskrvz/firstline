import type { ColumnMap } from "./csv";
import type { Slot } from "./template";
import type { Depth } from "./credits";

export type StyleRules = {
  language?: "auto" | "en" | "nl" | "de" | "fr";
  tone?: string;
  banned_phrases?: string[];
  extra_rules?: string[];
};

export type TemplateRow = {
  id: string;
  workspace_id: string;
  name: string;
  subject: string;
  body: string;
  slots: Slot[];
  style_rules: StyleRules;
  created_at: string;
  updated_at: string;
};

export type CampaignCounts = {
  total?: number;
  imported?: number;
  duplicates?: number;
  missing_email?: number;
  invalid_email?: number;
  no_website?: number;
  personal_email?: number;
};

export type CampaignRow = {
  id: string;
  workspace_id: string;
  template_id: string | null;
  name: string;
  status: "draft" | "preview" | "running" | "done" | "cancelled";
  mode: "now" | "economy";
  depth: Depth;
  writer: "pro" | "lite";
  column_map: ColumnMap;
  counts: CampaignCounts;
  created_at: string;
};

export type LeadRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  linkedin_headline: string | null;
  website: string | null;
  domain: string | null;
  custom: Record<string, string>;
  status: string;
};
