// Copy for the audience pages, English and Dutch (the Dutch is written as Dutch, not translated).
//   /for-small-business      ↔ /nl/kleine-bedrijven
//   /for-automation-builders ↔ /nl/automation-builders
// Numbers must stay true: prices from src/config/packs.ts, sending limits from src/lib/sender/schedule.ts,
// API limits from src/api/schemas.ts.
import { MAX_BATCH, RATE_LIMIT_PER_MIN } from "@/api/schemas";
import { BOUNCE_STEP_BACK_RATE, DEFAULT_WINDOW, GAP_MAX_MS, GAP_MIN_MS, WARMUP_START, WARMUP_STEP } from "@/lib/sender/schedule";

const gapMin = GAP_MIN_MS / 60_000;
const gapMax = GAP_MAX_MS / 60_000;
const bounce = Math.round(BOUNCE_STEP_BACK_RATE * 100);

export type PersonaSection =
  | { kind: "points"; id?: string; eyebrow: string; title: string; text?: string; points: { title: string; text: string }[] }
  | { kind: "facts"; id?: string; eyebrow: string; title: string; text?: string; facts: { value: string; label: string }[]; note?: string }
  | { kind: "steps"; id?: string; eyebrow: string; title: string; steps: { title: string; text: string }[] }
  | { kind: "code"; id?: string; eyebrow: string; title: string; text: string; link: { label: string; href: string } }
  | { kind: "status"; id?: string; eyebrow: string; title: string; rows: { name: string; status: string; text: string; ready: boolean }[]; note?: string };

export type PersonaCopy = {
  eyebrow: string;
  title: string;
  titleMuted: string;
  intro: string;
  cta: string;
  ctaHref: string;
  secondary: { label: string; href: string };
  note: string;
  sections: PersonaSection[];
  faqTitle: string;
  faq: { q: string; a: string }[];
  finalCta: { title: string; sub: string; cta: string };
};

export const SMALL_BUSINESS: Record<"en" | "nl", PersonaCopy> = {
  en: {
    eyebrow: "For small businesses",
    title: "Cold emails from your own Gmail, researched per lead.",
    titleMuted: "300 emails cost about €10.",
    intro:
      "You write your own cold email. FirstLine reads each lead's website, adds one line that shows you looked, and sends from your own inbox at a careful pace. No new tools to learn, no subscription.",
    cta: "Personalise 25 leads free",
    ctaHref: "/signup",
    secondary: { label: "How sending stays safe", href: "#sending" },
    note: "25 free emails after you confirm your address. No card.",
    sections: [
      {
        kind: "steps",
        eyebrow: "Your first hour",
        title: "From a list to your first emails",
        steps: [
          { title: "Upload a CSV", text: "Names, companies and websites. Export it from your CRM or a spreadsheet." },
          { title: "Paste your email", text: "The one you'd send anyway. Mark where the personal line goes with [[opener]]." },
          { title: "Check 5 for free", text: "See every line with the page it came from before anything is written for the rest." },
          { title: "Connect your Gmail", text: "Copy one Google Sheet into your own account and press Connect. That's the whole setup." },
        ],
      },
      {
        kind: "points",
        eyebrow: "Your own Gmail",
        title: "No new inbox, no setup, no password shared",
        points: [
          { title: "Sent from your address", text: "Emails go out from your own Gmail or Google Workspace inbox, so replies land where you already work." },
          { title: "We never get your password", text: "A small script in a Google Sheet that you own does the sending. You can stop it at any time by deleting the sheet." },
          { title: "Replies stop the sequence", text: "When someone answers, their follow-ups are cancelled. Sending and plain follow-ups are free." },
        ],
      },
      {
        kind: "facts",
        id: "sending",
        eyebrow: "Safe limits",
        title: "How FirstLine keeps your inbox healthy",
        text: "Google watches how new senders behave. FirstLine sends like a careful person would, and these limits are on for everyone.",
        facts: [
          { value: `${WARMUP_START} a day`, label: `A new inbox starts small and adds ${WARMUP_STEP} a day` },
          { value: "30 a day", label: "The most one inbox sends by default" },
          { value: `${gapMin}–${gapMax} min`, label: "Between two emails, never in bursts" },
          { value: `${DEFAULT_WINDOW.start}–${DEFAULT_WINDOW.end}`, label: "Weekdays only, in your time zone" },
          { value: `${bounce}%`, label: "Bounce rate at which sending slows down by itself" },
        ],
        note: "Nobody can promise an inbox never gets flagged. We recommend a separate domain for outreach, so your main address stays out of it.",
      },
      {
        kind: "facts",
        eyebrow: "What it costs",
        title: "300 emails ≈ €10",
        text: "You buy credits, 1 per finished email. They never expire, so a quiet month costs nothing.",
        facts: [
          { value: "€19", label: "500 emails (Starter)" },
          { value: "€69", label: "2,000 emails (Growth)" },
          { value: "€0", label: "Leads where the website has nothing useful" },
        ],
        note: "Prices excl. VAT. Sending from Gmail and plain follow-ups don't use credits.",
      },
    ],
    faqTitle: "Questions from small businesses",
    faq: [
      { q: "Do I need technical skills?", a: "No. If you can copy a Google Sheet and upload a CSV, you can use FirstLine." },
      { q: "Can I use my normal Gmail?", a: "Yes, but we recommend a Google Workspace inbox on a separate domain for outreach. Free Gmail accounts can send to at most 100 recipients a day through a script." },
      { q: "What if I only send 50 emails a month?", a: "Buy the smallest pack once. Credits never expire, so 500 emails last as long as you need them to." },
    ],
    finalCta: { title: "Try it on 25 of your own leads", sub: "Free, no card, credits never expire.", cta: "Personalise 25 leads free" },
  },
  nl: {
    eyebrow: "Voor kleine bedrijven",
    title: "Cold e-mails vanuit je eigen Gmail, per lead uitgezocht.",
    titleMuted: "300 e-mails kosten ongeveer €10.",
    intro:
      "Je schrijft je eigen cold e-mail. FirstLine leest de website van elke lead, voegt één zin toe waaruit blijkt dat je hebt gekeken, en verstuurt in een rustig tempo vanuit je eigen inbox. Geen nieuwe tools, geen abonnement.",
    cta: "Personaliseer 25 leads gratis",
    ctaHref: "/signup",
    secondary: { label: "Zo blijft versturen veilig", href: "#versturen" },
    note: "25 gratis e-mails zodra je je adres bevestigt. Geen creditcard nodig.",
    sections: [
      {
        kind: "steps",
        eyebrow: "Je eerste uur",
        title: "Van een lijst naar je eerste e-mails",
        steps: [
          { title: "Upload een CSV", text: "Namen, bedrijven en websites. Exporteer hem uit je CRM of een spreadsheet." },
          { title: "Plak je e-mail", text: "De e-mail die je toch al zou sturen. Zet [[opener]] waar de persoonlijke zin moet komen." },
          { title: "Bekijk er 5 gratis", text: "Zie elke zin met de pagina waar hij vandaan komt, voordat de rest wordt geschreven." },
          { title: "Koppel je Gmail", text: "Kopieer één Google Sheet naar je eigen account en klik op Koppelen. Meer installatie is er niet." },
        ],
      },
      {
        kind: "points",
        eyebrow: "Je eigen Gmail",
        title: "Geen nieuwe inbox, geen installatie, geen wachtwoord delen",
        points: [
          { title: "Verstuurd vanaf jouw adres", text: "E-mails gaan uit vanuit je eigen Gmail- of Google Workspace-inbox, dus antwoorden komen binnen waar je al werkt." },
          { title: "Wij krijgen nooit je wachtwoord", text: "Een klein script in een Google Sheet van jezelf doet het versturen. Je stopt het wanneer je wilt door de sheet te verwijderen." },
          { title: "Een antwoord stopt de reeks", text: "Reageert iemand, dan vervallen de follow-ups. Versturen en gewone follow-ups zijn gratis." },
        ],
      },
      {
        kind: "facts",
        id: "versturen",
        eyebrow: "Veilige limieten",
        title: "Zo houdt FirstLine je inbox gezond",
        text: "Google let op hoe nieuwe afzenders zich gedragen. FirstLine verstuurt zoals een zorgvuldig mens dat zou doen, en deze limieten staan voor iedereen aan.",
        facts: [
          { value: `${WARMUP_START} per dag`, label: `Een nieuwe inbox begint klein en groeit met ${WARMUP_STEP} per dag` },
          { value: "30 per dag", label: "Het maximum per inbox, standaard" },
          { value: `${gapMin}–${gapMax} min`, label: "Tussen twee e-mails, nooit in één keer" },
          { value: `${DEFAULT_WINDOW.start}–${DEFAULT_WINDOW.end}`, label: "Alleen op werkdagen, in jouw tijdzone" },
          { value: `${bounce}%`, label: "Bouncepercentage waarboven het tempo vanzelf omlaag gaat" },
        ],
        note: "Niemand kan beloven dat een inbox nooit wordt gemarkeerd. We raden een apart domein voor outreach aan, zodat je hoofdadres erbuiten blijft.",
      },
      {
        kind: "facts",
        eyebrow: "Wat het kost",
        title: "300 e-mails ≈ €10",
        text: "Je koopt credits, 1 per afgeronde e-mail. Ze verlopen nooit, dus een rustige maand kost niets.",
        facts: [
          { value: "€19", label: "500 e-mails (Starter)" },
          { value: "€69", label: "2.000 e-mails (Growth)" },
          { value: "€0", label: "Leads waarvan de website niets bruikbaars heeft" },
        ],
        note: "Prijzen excl. btw. Versturen via Gmail en gewone follow-ups kosten geen credits.",
      },
    ],
    faqTitle: "Vragen van kleine bedrijven",
    faq: [
      { q: "Heb ik technische kennis nodig?", a: "Nee. Kun je een Google Sheet kopiëren en een CSV uploaden, dan kun je FirstLine gebruiken." },
      { q: "Kan ik mijn gewone Gmail gebruiken?", a: "Ja, maar we raden een Google Workspace-inbox op een apart domein aan. Gratis Gmail-accounts kunnen via een script maximaal 100 ontvangers per dag mailen." },
      { q: "En als ik maar 50 e-mails per maand verstuur?", a: "Koop één keer het kleinste pakket. Credits verlopen nooit, dus 500 e-mails gaan zo lang mee als jij wilt." },
    ],
    finalCta: { title: "Probeer het op 25 van je eigen leads", sub: "Gratis, geen creditcard, credits verlopen nooit.", cta: "Personaliseer 25 leads gratis" },
  },
};

export const AUTOMATION: Record<"en" | "nl", PersonaCopy> = {
  en: {
    eyebrow: "For automation builders",
    title: "Researched first lines inside the flows you build.",
    titleMuted: "One lead in, one line with its sources out.",
    intro:
      "Call FirstLine from your own code, n8n or Make. It reads the lead's website, writes the marked spots in your template, checks them, and returns JSON with every fact and URL it used. You pay per finished email.",
    cta: "Get an API key free",
    ctaHref: "/signup",
    secondary: { label: "Read the API docs", href: "/docs/api" },
    note: "25 free credits after you confirm your address. The same credits work in the app and the API.",
    sections: [
      {
        kind: "code",
        eyebrow: "The API",
        title: "A REST call your flow can wait for",
        text: `POST a lead and wait up to 60 seconds, or get a webhook when it's done. Batches of up to ${MAX_BATCH} leads, ${RATE_LIMIT_PER_MIN} requests a minute, and an Idempotency-Key so a retry never charges twice.`,
        link: { label: "Read the API docs", href: "/docs/api" },
      },
      {
        kind: "status",
        eyebrow: "Where it runs",
        title: "Your code, n8n or Make",
        rows: [
          { name: "REST API", status: "Live", text: "Personalise, batch, jobs, credits and webhooks. Documented with an OpenAPI file.", ready: true },
          { name: "n8n node", status: "Built, being listed", text: "Lead → Personalise, Job → Get, Credit → Get balance. Until it's in n8n's directory, ask us for the package.", ready: false },
          { name: "Make app", status: "Built, being listed", text: "The same actions as the n8n node. Until it's public in Make, ask us for an invite.", ready: false },
        ],
        note: "Until the n8n node and Make app are listed, the HTTP Request module in either tool works with the REST API.",
      },
      {
        kind: "points",
        eyebrow: "For your clients",
        title: "Personalisation as part of what you deliver",
        points: [
          { title: "A workspace per client", text: "Separate leads, templates, credits and API keys for each client, switchable from one login." },
          { title: "Answers you can show", text: "Every line comes back with the facts and URLs behind it, so your client can see why it was written." },
          { title: "Nothing made up", text: "If a website has nothing useful, the result says so and costs 0 credits. Your flow decides what to do next." },
        ],
      },
      {
        kind: "facts",
        eyebrow: "Volume pricing",
        title: "From €0.030 per email",
        text: "The same packs as in the app. Credits never expire and only finished emails use one.",
        facts: [
          { value: "€0.038", label: "per email in the 500 pack (€19)" },
          { value: "€0.035", label: "per email in the 2,000 pack (€69)" },
          { value: "€0.030", label: "per email in the 10,000 pack (€299)" },
        ],
        note: "Prices excl. VAT. Sending more than 10,000 a month? Tell us about your volume on the agencies page.",
      },
    ],
    faqTitle: "Questions from builders",
    faq: [
      { q: "Which languages?", a: "English and Dutch, picked from the language of your template." },
      { q: "What do I get back?", a: "The finished slots, the facts used with their URLs, a confidence label, and the credits used. Neutral results carry a reason and cost 0." },
      { q: "How do I test without spending?", a: "Each new account gets 25 free credits. Leads with nothing useful on their website cost 0, so failed tests don't use credits either." },
    ],
    finalCta: { title: "Try the API on 25 leads", sub: "Free, no card, credits never expire.", cta: "Get an API key free" },
  },
  nl: {
    eyebrow: "Voor automation builders",
    title: "Onderzochte openingszinnen in de flows die je bouwt.",
    titleMuted: "Eén lead erin, één zin met bronnen eruit.",
    intro:
      "Roep FirstLine aan vanuit je eigen code, n8n of Make. Het leest de website van de lead, schrijft de gemarkeerde plekken in je template, controleert ze, en geeft JSON terug met elk feit en elke URL die het gebruikte. Je betaalt per afgeronde e-mail.",
    cta: "Gratis API-sleutel aanmaken",
    ctaHref: "/signup",
    secondary: { label: "Lees de API-documentatie (Engels)", href: "/docs/api" },
    note: "25 gratis credits zodra je je adres bevestigt. Dezelfde credits werken in de app en de API.",
    sections: [
      {
        kind: "code",
        eyebrow: "De API",
        title: "Een REST-call waar je flow op kan wachten",
        text: `POST een lead en wacht tot 60 seconden, of krijg een webhook als hij klaar is. Batches tot ${MAX_BATCH} leads, ${RATE_LIMIT_PER_MIN} verzoeken per minuut, en een Idempotency-Key zodat een nieuwe poging nooit dubbel kost.`,
        link: { label: "Lees de API-documentatie (Engels)", href: "/docs/api" },
      },
      {
        kind: "status",
        eyebrow: "Waar het draait",
        title: "Je eigen code, n8n of Make",
        rows: [
          { name: "REST API", status: "Live", text: "Personaliseren, batches, jobs, credits en webhooks. Beschreven in een OpenAPI-bestand.", ready: true },
          { name: "n8n-node", status: "Gebouwd, wordt aangemeld", text: "Lead → Personalise, Job → Get, Credit → Get balance. Zolang hij nog niet in de n8n-directory staat, vraag ons om het pakket.", ready: false },
          { name: "Make-app", status: "Gebouwd, wordt aangemeld", text: "Dezelfde acties als de n8n-node. Zolang hij nog niet openbaar is in Make, vraag ons om een uitnodiging.", ready: false },
        ],
        note: "Tot de n8n-node en de Make-app vermeld staan, werkt de HTTP Request-module in beide tools met de REST API.",
      },
      {
        kind: "points",
        eyebrow: "Voor je klanten",
        title: "Personalisatie als onderdeel van wat je oplevert",
        points: [
          { title: "Een workspace per klant", text: "Aparte leads, templates, credits en API-sleutels per klant, te wisselen vanuit één login." },
          { title: "Uitleg die je kunt laten zien", text: "Elke zin komt terug met de feiten en URL's erachter, zodat je klant ziet waarom hij zo is geschreven." },
          { title: "Niets verzonnen", text: "Heeft een website niets bruikbaars, dan staat dat in het resultaat en kost het 0 credits. Jouw flow bepaalt wat er daarna gebeurt." },
        ],
      },
      {
        kind: "facts",
        eyebrow: "Volumeprijzen",
        title: "Vanaf €0,030 per e-mail",
        text: "Dezelfde pakketten als in de app. Credits verlopen nooit en alleen afgeronde e-mails kosten er een.",
        facts: [
          { value: "€0,038", label: "per e-mail in het pakket van 500 (€19)" },
          { value: "€0,035", label: "per e-mail in het pakket van 2.000 (€69)" },
          { value: "€0,030", label: "per e-mail in het pakket van 10.000 (€299)" },
        ],
        note: "Prijzen excl. btw. Meer dan 10.000 per maand? Vertel ons over je volume op de pagina voor bureaus (Engels).",
      },
    ],
    faqTitle: "Vragen van builders",
    faq: [
      { q: "Welke talen?", a: "Nederlands en Engels, op basis van de taal van je template." },
      { q: "Wat krijg ik terug?", a: "De ingevulde plekken, de gebruikte feiten met hun URL's, een betrouwbaarheidslabel en de gebruikte credits. Neutrale resultaten hebben een reden en kosten 0." },
      { q: "Hoe test ik zonder te betalen?", a: "Elk nieuw account krijgt 25 gratis credits. Leads waarvan de website niets bruikbaars heeft kosten 0, dus mislukte tests kosten ook geen credits." },
    ],
    finalCta: { title: "Probeer de API op 25 leads", sub: "Gratis, geen creditcard, credits verlopen nooit.", cta: "Gratis API-sleutel aanmaken" },
  },
};
