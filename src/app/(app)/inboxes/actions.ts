"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { validateWindow } from "@/lib/sender/schedule";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";
import { createInbox, rotateInboxKey, setInboxPaused } from "@/sender/db";

const NOT_CONFIGURED = "Sending needs the database connection (DATABASE_URL in .env.local).";

const AddInbox = z.object({
  email: z.email("Enter the Gmail address you'll send from.").max(254),
  tz: z.string().min(1).max(64),
  start: z.string().max(5),
  end: z.string().max(5),
  days: z.array(z.number().int().min(1).max(7)).max(7),
  daily_cap: z.number().int().min(1, "At least 1 a day.").max(100, "Free Gmail allows 100 a day; keep it at 100 or lower."),
});

export async function addInbox(
  input: z.input<typeof AddInbox>,
): Promise<{ error: string } | { key: string; email: string; updated: boolean }> {
  const parsed = AddInbox.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid inbox." };
  const { email, tz, start, end, days, daily_cap } = parsed.data;
  const window = { days: [...new Set(days)].sort(), start, end, tz };
  const bad = validateWindow(window);
  if (bad) return { error: bad };
  if (!queueConfigured()) return { error: NOT_CONFIGURED };

  const { workspace } = await requireWorkspace();
  const { key, updated } = await createInbox(serverPool(), { workspaceId: workspace.id, email, window, dailyCap: daily_cap });
  revalidatePath("/inboxes");
  return { key, email: email.toLowerCase(), updated };
}

export async function newInboxKey(inboxId: string): Promise<{ error: string } | { key: string; email: string }> {
  if (!z.uuid().safeParse(inboxId).success) return { error: "Invalid inbox." };
  if (!queueConfigured()) return { error: NOT_CONFIGURED };
  const { workspace } = await requireWorkspace();
  const key = await rotateInboxKey(serverPool(), workspace.id, inboxId);
  if (!key) return { error: "Inbox not found." };
  const { rows } = await serverPool().query("select email from public.inboxes where id = $1", [inboxId]);
  revalidatePath("/inboxes");
  return { key, email: rows[0].email };
}

export async function pauseInbox(inboxId: string, paused: boolean): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(inboxId).success) return { error: "Invalid inbox." };
  if (!queueConfigured()) return { error: NOT_CONFIGURED };
  const { workspace } = await requireWorkspace();
  await setInboxPaused(serverPool(), workspace.id, inboxId, paused);
  revalidatePath("/inboxes");
}
