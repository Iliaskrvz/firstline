import type { Metadata } from "next";
import Link from "next/link";
import { company } from "@/lib/legal";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Privacy() {
  const c = company();
  return (
    <LegalPage title="Privacy policy">
      <p>
        FirstLine is run by {c.name}, {c.address} (Chamber of Commerce {c.kvk}). Questions about privacy: <a className="text-indigo-600" href={`mailto:${c.email}`}>{c.email}</a>.
      </p>

      <h2>Two roles</h2>
      <p>
        <strong>Your account.</strong> For your own sign-in, billing and usage data we are the <em>controller</em>: we decide why and how it is used, and this policy applies.
      </p>
      <p>
        <strong>Your leads.</strong> The lead lists you upload and the emails FirstLine writes for them are processed on your instructions. For that data you are the controller and we are your <em>processor</em>, under our <Link className="text-indigo-600" href="/dpa">Data Processing Agreement</Link>. You need your own lawful basis to email the people on your list.
      </p>

      <h2>What we collect about you</h2>
      <ul>
        <li>Account: email address, name if you give it, workspace settings.</li>
        <li>Billing: credit purchases and usage. Payments are handled by Kelviq as merchant of record; we never see your card or bank details.</li>
        <li>Usage and logs: what you run, costs per run, error logs, IP address in server logs.</li>
        <li>Connected inboxes: the Gmail address you connect and a per-inbox key. We never receive your Google password or access to your mailbox; the Google Sheet you install sends the emails and reports back which were sent, replied to or bounced.</li>
      </ul>

      <h2>Why (legal basis)</h2>
      <ul>
        <li>To provide the service you signed up for (contract).</li>
        <li>To bill you and keep accounting records (legal obligation).</li>
        <li>To prevent abuse and spam, keep the service secure and improve quality (legitimate interest).</li>
        <li>Product emails about your account, such as an inbox going offline (contract). No marketing emails without your consent.</li>
      </ul>

      <h2>How long</h2>
      <ul>
        <li>Lead data (names, emails, generated copy): deleted 30 days after a campaign ends. A campaign ends when you end it, or automatically after 90 days without activity.</li>
        <li>Company website facts: cached for up to 30 days so the same site is not read twice.</li>
        <li>Account data: as long as your account exists, then deleted within 30 days.</li>
        <li>Invoices and payment records: 7 years (Dutch tax law).</li>
      </ul>

      <h2>Who else processes it</h2>
      <p>
        A short list of providers we use, see <Link className="text-indigo-600" href="/subprocessors">sub-processors</Link>. Some are in the United States; transfers are covered by Standard Contractual Clauses or the EU-US Data Privacy Framework. We do not sell personal data and do not use your leads to train AI models. Our AI provider does not train on API data.
      </p>

      <h2>Cookies</h2>
      <p>We only use cookies that are needed to keep you signed in. No tracking or advertising cookies.</p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, export or delete your data, or object to how we use it, by emailing {c.email}. We answer within one month. You can also complain to the Dutch Data Protection Authority (Autoriteit Persoonsgegevens).
      </p>
      <p>
        Are you on someone&apos;s lead list and want to be removed? Reply to their email, or contact the sender: they decide about their list. You can also email us and we will pass it on and suppress your address in that workspace.
      </p>
    </LegalPage>
  );
}
