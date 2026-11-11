import type { Metadata } from "next";
import { LegalPage, SubprocessorTable } from "../legal-page";

export const metadata: Metadata = { title: "Sub-processors" };

export default function Subprocessors() {
  return (
    <LegalPage title="Sub-processors">
      <p>These companies process personal data for FirstLine. Transfers outside the EU are covered by the European Commission&apos;s Standard Contractual Clauses (SCCs) or the EU-US Data Privacy Framework.</p>
      <SubprocessorTable />
      <p>Emails are sent from your own Gmail or Google Workspace account through a Google Sheet you install yourself. Google is your provider there, not ours: FirstLine never receives your Google password or mailbox access.</p>
      <p>We announce new sub-processors on this page at least 14 days before they start. Customers with a signed DPA can object in that period.</p>
    </LegalPage>
  );
}
