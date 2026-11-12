"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import type { Role } from "@/lib/team";
import { cancelInvite, inviteMember, makeOwner, removeFromTeam, setRole } from "./actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRoleValue] = useState<"member" | "admin">("member");
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setResult(null);
          start(async () => {
            const r = await inviteMember({ email, role });
            if ("error" in r) setError(r.error);
            else {
              setResult(r);
              setEmail("");
              setCopied(false);
            }
          });
        }}
      >
        <div className="min-w-56 flex-1">
          <Field label="Email address">
            <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
          </Field>
        </div>
        <Field label="Role">
          <select className={inputClass} value={role} onChange={(e) => setRoleValue(e.target.value as "member" | "admin")}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Button type="submit" disabled={pending || !email.trim()}>
          Invite
        </Button>
      </form>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {result && (
        <div className="space-y-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-950">
          <p>{result.emailed ? "Invite sent by email. You can also share this link:" : "Send this link to them (valid 7 days). They sign in with the invited address and join."}</p>
          <div className="flex gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-white px-2 py-1.5 text-xs">{result.link}</code>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(result.link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CancelInvite({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => start(async () => void (await cancelInvite(id)))}>
      Cancel
    </Button>
  );
}

export function MemberActions(p: { userId: string; email: string; role: Role; isSelf: boolean; canRemove: boolean; canChangeRole: boolean; canTransfer: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (fn: () => Promise<{ error: string } | object>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if ("error" in r) setError(r.error as string);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-xs text-rose-700">{error}</span>}
      {p.canChangeRole && (
        <select
          className={`${inputClass} w-auto py-1 text-xs`}
          value={p.role}
          disabled={pending}
          onChange={(e) => act(() => setRole(p.userId, p.email, e.target.value as "admin" | "member"))}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      )}
      {p.canTransfer && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (confirm(`Make ${p.email} the owner? You become an admin.`)) act(() => makeOwner(p.userId, p.email));
          }}
        >
          Make owner
        </Button>
      )}
      {p.canRemove && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            if (!confirm(p.isSelf ? "Leave this workspace? You lose access at once." : `Remove ${p.email}? They lose access at once.`)) return;
            start(async () => {
              setError(null);
              const r = await removeFromTeam(p.userId, p.email);
              if ("error" in r) setError(r.error);
              else if (r.left) router.push("/campaigns");
            });
          }}
        >
          {p.isSelf ? "Leave" : "Remove"}
        </Button>
      )}
    </div>
  );
}
