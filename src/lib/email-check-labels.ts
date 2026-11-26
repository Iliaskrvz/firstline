// Email check statuses, reasons and their labels: safe for the browser (no file or network access).
export type EmailStatus = "pending" | "valid" | "risky" | "invalid";
export type EmailReason = "syntax" | "disposable" | "null_mx" | "no_dns" | "typo" | "a_only" | "role" | "personal" | "dns_unknown";

export const REASON_LABEL: Record<EmailReason, string> = {
  syntax: "Not a valid email address",
  disposable: "Throwaway email domain",
  null_mx: "Domain doesn't accept email",
  no_dns: "Domain doesn't exist",
  typo: "Possible typo in the domain",
  a_only: "Domain has no mail server",
  role: "Role address (info@, sales@…)",
  personal: "Personal address (gmail.com, outlook.com…)",
  dns_unknown: "Domain couldn't be checked",
};

