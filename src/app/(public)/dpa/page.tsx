import type { Metadata } from "next";
import Link from "next/link";
import { company } from "@/lib/legal";
import { LegalPage, SubprocessorTable } from "../legal-page";

export const metadata: Metadata = { title: "Data Processing Agreement" };

export default function Dpa() {
  const c = company();
  return (
    <LegalPage title="Data Processing Agreement">
      <p>
        This Data Processing Agreement (&quot;DPA&quot;) is part of the <Link className="text-brand-600" href="/terms">terms of service</Link> between you (the customer, &quot;controller&quot;) and {c.name} (&quot;processor&quot;). It meets Article 28 of the GDPR. It applies automatically; if you need a signed copy, email {c.email}.
      </p>

      <h2>1. Subject and duration</h2>
      <p>The processor processes personal data only to provide FirstLine to the controller, for as long as the controller uses FirstLine, and deletes it as described in section 7.</p>

      <h2>2. Data and people</h2>
      <ul>
        <li>People: the controller&apos;s prospects and contacts (business contact persons).</li>
        <li>Data: name, business email address, job title, company, company website, LinkedIn headline if provided, generated emails, send and reply status.</li>
        <li>No special categories of data. The controller does not upload them.</li>
      </ul>

      <h2>3. Purpose</h2>
      <p>Reading public company websites, writing personalised email copy, checking it, sending it through inboxes the controller connects, detecting replies and bounces, and reporting results.</p>

      <h2>4. Processor obligations</h2>
      <ul>
        <li>Process only on the controller&apos;s documented instructions (the settings and actions in FirstLine count as instructions).</li>
        <li>Keep the data confidential; only people who need access have it, under confidentiality duties.</li>
        <li>Take appropriate security measures (Annex 1).</li>
        <li>Help the controller answer data subject requests and with impact assessments where reasonable.</li>
        <li>Report a personal data breach without undue delay and within 48 hours of discovering it.</li>
        <li>Make available the information needed to show compliance, and allow reasonable audits once a year with 30 days&apos; notice, at the controller&apos;s cost.</li>
        <li>Not use the data for its own purposes, sell it, or use it to train AI models.</li>
      </ul>

      <h2>5. Sub-processors</h2>
      <p>The controller gives general permission to use the sub-processors below. The processor imposes the same data protection duties on them, announces new ones at least 14 days ahead on the <Link className="text-brand-600" href="/subprocessors">sub-processor page</Link>, and the controller may object on reasonable grounds (and end the contract if no solution is found).</p>
      <SubprocessorTable />

      <h2>6. Transfers outside the EU</h2>
      <p>Transfers to sub-processors outside the EEA are covered by the European Commission&apos;s Standard Contractual Clauses or the EU-US Data Privacy Framework.</p>

      <h2>7. Deletion</h2>
      <p>Lead data is deleted automatically 30 days after a campaign ends (or after 90 days without activity). When the contract ends, all remaining personal data is deleted within 30 days, unless the law requires keeping it. The controller can export its data (CSV) before that.</p>

      <h2>8. Liability</h2>
      <p>The liability limits of the terms of service apply.</p>

      <h2>Annex 1: Security measures</h2>
      <ul>
        <li>Encryption in transit (HTTPS/TLS) everywhere and at rest in the database.</li>
        <li>Row-level security: each workspace can only read its own data.</li>
        <li>Per-inbox secret keys for the sending connection; no Google passwords or mailbox access stored.</li>
        <li>Access to production limited to the founder, with key-based sign-in.</li>
        <li>Automatic data deletion as in section 7.</li>
      </ul>
    </LegalPage>
  );
}
