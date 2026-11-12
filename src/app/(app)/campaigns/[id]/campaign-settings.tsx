"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Field, inputClass } from "@/components/ui";
import { updateCampaignDeep, updateCampaignSettings, updateCampaignWriter } from "../actions";

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

/** Pro (Sonnet writes, 3–4 pages read) or Lite (Haiku writes, 2 pages). Lite runs use Lite credits first. */
export function WriterSetting({ campaignId, writer, locked }: { campaignId: string; writer: "pro" | "lite"; locked: boolean }) {
  const [value, setValue] = useState(writer);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Field label="Writer" hint={value === "lite" ? "Shorter research and a smaller AI model. Uses Lite credits first, then normal credits." : "The best quality. Uses normal credits."}>
      <select
        className={inputClass}
        value={value}
        disabled={pending || locked}
        onChange={(e) => {
          const v = e.target.value as "pro" | "lite";
          setValue(v);
          setError(null);
          startTransition(async () => {
            const res = await updateCampaignWriter(campaignId, v);
            if (res && "error" in res) setError(res.error);
          });
        }}
      >
        <option value="pro">Pro</option>
        <option value="lite">Lite</option>
      </select>
      {locked && <p className="mt-1 text-xs text-slate-500">Can&apos;t change while the campaign is running.</p>}
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </Field>
  );
}

/** Deep research (+1 credit, only when a fact about the contact's own work is used). Shown only when switched on. */
export function DeepSetting({ campaignId, deep, locked }: { campaignId: string; deep: boolean; locked: boolean }) {
  const [on, setOn] = useState(deep);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 accent-indigo-600"
          checked={on}
          disabled={pending || locked}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            setError(null);
            startTransition(async () => {
              const r = await updateCampaignDeep(campaignId, v);
              if (r && "error" in r) {
                setError(r.error);
                setOn(!v);
              }
            });
          }}
        />
        <span>
          + Deep: the contact&apos;s own published work (+1 credit, only when used)
          <span className="block text-xs text-slate-500">
            At most 2 facts from an article, talk, podcast or company news by the contact for their current company. No LinkedIn, nothing personal. No confident
            match = not used, not charged.
          </span>
        </span>
      </label>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
