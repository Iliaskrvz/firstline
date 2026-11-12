import type { Metadata } from "next";
import Link from "next/link";
import { company } from "@/lib/legal";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms of service" };

export default function Terms() {
  const c = company();
  return (
    <LegalPage title="Terms of service">
      <p>These terms apply to FirstLine, run by {c.name} (Chamber of Commerce {c.kvk}). By creating an account you accept them. FirstLine is for businesses, not consumers.</p>

      <h2>1. What FirstLine does</h2>
      <p>FirstLine reads public company websites, writes the personalised parts of your cold emails based on cited facts, and can send them from inboxes you connect. You stay the sender of every email.</p>

      <h2>2. Your responsibilities</h2>
      <ul>
        <li>You are responsible for lawful outreach: you need a lawful basis to email each person on your lists (for example legitimate interest for relevant B2B contact) and must follow the e-privacy, anti-spam and data protection rules that apply to you and your recipients.</li>
        <li>Every email must identify you as the sender and give an easy way to opt out. FirstLine adds an opt-out line and stops a sequence on a reply; do not remove or work around these.</li>
        <li>No spam, phishing, impersonation, malware, deceptive claims, or emails about illegal products or services.</li>
        <li>Do not upload lists you are not allowed to use, such as bought lists of personal addresses without a lawful basis.</li>
        <li>You are responsible for your connected email accounts and for following your email provider&apos;s rules and sending limits.</li>
        <li>Review what FirstLine writes. AI output can be wrong; you decide what is sent.</li>
      </ul>

      <h2>3. Abuse</h2>
      <p>We may pause sending, suspend a workspace or close an account without notice if we see spam, phishing, high complaint or bounce rates, or other misuse. Credits used for misuse are not refunded.</p>

      <h2>4. Credits and payment</h2>
      <ul>
        <li>You buy credit packs in advance. Prices are shown before you pay. Payments are processed by Kelviq, our merchant of record, which also issues the invoice.</li>
        <li>Credits are reserved when a run starts and only used for leads that get a finished email. Leads without usable facts and stopped runs are returned to your balance.</li>
        <li>Credits never expire. They are not refundable, except where the law requires it or when the service fails on our side.</li>
      </ul>

      <h2>5. Your data</h2>
      <p>Your lead lists and generated emails are yours. We process them only to provide the service, under our <Link className="text-brand-600" href="/dpa">Data Processing Agreement</Link>, which is part of these terms. See also our <Link className="text-brand-600" href="/privacy">privacy policy</Link>.</p>

      <h2>6. Availability and changes</h2>
      <p>We work to keep FirstLine available but do not guarantee it is uninterrupted. We may change features. We tell you about material changes to these terms at least 30 days in advance by email.</p>

      <h2>7. Liability</h2>
      <p>Our total liability is limited to the amount you paid us in the 12 months before the claim. We are not liable for indirect damage, lost profit, deliverability or reply results, or for consequences of emails you send. This does not limit liability for intent or gross negligence.</p>

      <h2>8. Ending</h2>
      <p>You can stop using FirstLine and ask us to delete your account at any time. We can end your account with 30 days&apos; notice, or immediately for a serious breach of these terms.</p>

      <h2>9. Law</h2>
      <p>Dutch law applies. Disputes go to the competent court in the Netherlands.</p>
    </LegalPage>
  );
}
