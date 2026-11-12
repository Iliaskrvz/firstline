"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { addWebhook, createKey, removeWebhook, revokeKey } from "./actions";

function ShowOnce({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">{label}: copy it now. It won&apos;t be shown again.</p>
      <div className="flex gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-white px-2 py-1.5 text-xs">{value}</code>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function NewKey() {
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {key && <ShowOnce label="Your new API key" value={key} />}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await createKey(name);
            if ("error" in r) setError(r.error);
            else {
              setKey(r.key);
              setName("");
            }
          });
        }}
      >
        <div className="min-w-48 flex-1">
          <Field label="New key name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. n8n" maxLength={60} />
          </Field>
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          Create key
        </Button>
      </form>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}

export function RevokeKey({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => {
        if (confirm(`Revoke "${name}"? Anything using it stops working at once.`)) start(async () => void (await revokeKey(id)));
      }}
    >
      Revoke
    </Button>
  );
}

export function NewWebhook() {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["job.completed", "batch.completed"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {secret && <ShowOnce label="Signing secret for this webhook" value={secret} />}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await addWebhook(url, events);
            if ("error" in r) setError(r.error);
            else {
              setSecret(r.secret);
              setUrl("");
            }
          });
        }}
      >
        <Field label="Webhook URL">
          <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-n8n.example.com/webhook/…" />
        </Field>
        <div className="flex flex-wrap gap-4 text-sm text-slate-700">
          {["job.completed", "batch.completed"].map((ev) => (
            <label key={ev} className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-brand-600" checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} />
              {ev}
            </label>
          ))}
        </div>
        <Button type="submit" disabled={pending || !url.trim()}>
          Add webhook
        </Button>
      </form>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}

export function RemoveWebhook({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(async () => void (await removeWebhook(id)))}>
      Remove
    </Button>
  );
}
