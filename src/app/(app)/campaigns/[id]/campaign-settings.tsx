"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Field, inputClass } from "@/components/ui";
import { updateCampaignSettings } from "../actions";

export function CampaignSettings({
  campaignId,
  templateId,
  templates,
}: {
  campaignId: string;
  templateId: string | null;
  templates: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(templateId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(v: string) {
    setValue(v);
    setError(null);
    startTransition(async () => {
      const res = await updateCampaignSettings({ id: campaignId, template_id: v || null });
      if (res && "error" in res) setError(res.error ?? "Could not save.");
    });
  }

  return (
    <Field
      label="Template"
      hint={
        templates.length === 0 ? (
          <>
            No templates yet.{" "}
            <Link href={`/templates/new?campaign=${campaignId}`} className="font-medium text-indigo-700 hover:underline">
              Write one
            </Link>
          </>
        ) : (
          <Link href={`/templates/new?campaign=${campaignId}`} className="font-medium text-indigo-700 hover:underline">
            + New template
          </Link>
        )
      }
    >
      <select className={inputClass} value={value} onChange={(e) => change(e.target.value)} disabled={pending}>
        <option value="">Choose a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </Field>
  );
}
