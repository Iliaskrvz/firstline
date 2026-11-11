"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import type { Provider } from "@/integrations/types";
import { connectIntegration, disconnect, retest } from "./actions";

export function ConnectForm({ provider, fakeHint }: { provider: Provider; fakeHint: boolean }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const r = await connectIntegration({ provider, apiKey: key });
          if ("error" in r) setMsg({ tone: "error", text: r.error });
          else {
            setKey("");
            setMsg({ tone: "ok", text: r.note ?? "Connected. Replies, bounces and unsubscribes will come in by webhook." });
          }
        });
      }}
    >
      <Field label="API key" hint={fakeHint ? `Testing without an account? Use the key "fake-${provider}".` : undefined}>
        <input type="password" autoComplete="off" spellCheck={false} className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your API key" />
      </Field>
      <Button type="submit" disabled={pending || key.trim().length < 8}>
        {pending ? "Testing…" : "Test and save"}
      </Button>
      {msg && <p className={msg.tone === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>{msg.text}</p>}
    </form>
  );
}

export function IntegrationActions({ integrationId }: { integrationId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await retest(integrationId);
            setMsg("error" in r ? r.error : r.message);
          })
        }
      >
        Test again
      </Button>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (!confirm("Disconnect? The key is deleted and webhooks are removed. Leads already in the tool stay there.")) return;
          start(async () => {
            const r = await disconnect(integrationId);
            if ("error" in r) setMsg(r.error);
          });
        }}
      >
        Disconnect
      </Button>
    </div>
  );
}
