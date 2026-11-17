// Homepage copy (Nederlands), same shape as home.ts. Geschreven als Nederlandse tekst, niet vertaald:
// je-vorm, direct, rustig, geen uitroeptekens of hypewoorden. Getallen blijven gelijk aan de Engelse
// versie (prijzen uit src/config/packs.ts, limieten uit src/lib/sender/schedule.ts, concurrenten uit
// src/content/competitors.ts).
import { anchorRange300, checkedOnLabel } from "./competitors";
import type { HomeCopy } from "./home";

const range = anchorRange300();

export const HOME_NL: HomeCopy = {
  meta: {
    title: "FirstLine: cold e-mails met onderzoek per lead, vanaf €0,03 per e-mail",
    description:
      "Upload je leads en plak je eigen cold e-mail. FirstLine leest de website van elk bedrijf en schrijft alleen de persoonlijke zinnen, elk met een bron. Vanaf €0,03 per e-mail, geen abonnement.",
    ogTitle: "Cold e-mails alsof je elke lead zelf hebt uitgezocht",
    ogDescription: "Je eigen tekst, per lead onderzocht, met een bron bij elke zin. Vanaf €0,03 per e-mail, geen abonnement, gratis verstuurd vanuit je eigen Gmail.",
  },

  hero: {
    headline: "Cold e-mails alsof je elke lead zelf hebt uitgezocht.",
    headlineMuted: "Vanaf €0,03 per stuk, zonder abonnement.",
    sub: "Voor oprichters en kleine B2B-teams die hun eigen cold e-mails schrijven. Upload je leads, plak je e-mail en zie binnen ongeveer 10 minuten je eerste onderzochte e-mails.",
    cta: "Personaliseer 25 leads gratis",
    secondary: "Bekijk prijzen",
    note: "25 gratis e-mails zodra je je adres bevestigt. Geen creditcard nodig.",
    footnote: "Bij elke persoonlijke zin staat de pagina waar die vandaan komt.",
  },

  problem: {
    eyebrow: "Het probleem",
    title: "Waarom de meeste cold e-mails onbeantwoord blijven",
    items: [
      {
        title: "Algemene AI-openers vallen niet op",
        text: "“Ik kwam jullie bedrijf tegen en was onder de indruk…” Die zin krijgen je prospects elke dag. Ze zien meteen dat niemand echt heeft gekeken.",
      },
      {
        title: "Echt onderzoek kost tijd die je niet hebt",
        text: "Vijf minuten per website is 25 uur voor 300 leads. De meeste mensen stoppen na tien.",
      },
      {
        title: "Tools die het wel doen, rekenen elke maand",
        text: `Tools met AI-personalisatie vragen ${range.currency}${range.min}–${range.max} per maand voor een abonnement dat 300 e-mails dekt, of je ze nu verstuurt of niet.`,
      },
    ],
  },

  demo: {
    url: "bakkerijvos.nl/nieuws",
    pageTitle: "Nieuws",
    before: "Ambachtelijk brood sinds 1987, elke ochtend vers uit eigen oven.",
    fact: "Vanaf 1 maart ook open in Utrecht-Oost.",
    after: "Kom langs voor een gratis proeverij in de eerste week.",
    factId: "F2",
    emailLabel: "Jouw e-mail, gepersonaliseerd",
    greeting: "Hoi Sanne,",
    opener: "Zag dat Bakkerij Vos net een tweede winkel in Utrecht-Oost heeft geopend, gefeliciteerd.",
    rest: "Wij helpen bakkerijen minder weg te gooien met dagelijkse bestelvoorspellingen. Zin in een kort gesprek volgende week?",
    source: "bakkerijvos.nl/nieuws",
  },

  liveDemo: {
    eyebrow: "Live demo",
    title: "Probeer het op een bedrijfswebsite",
    text: "Plak een website. FirstLine leest twee pagina's en schrijft één voorbeeldopener, met de bronnen die het gebruikte. Geen account nodig.",
    urlLabel: "Website van het bedrijf",
    urlPlaceholder: "bedrijf.nl",
    sellsLabel: "Wat je verkoopt, in één zin (optioneel)",
    sellsPlaceholder: "Boekhouding voor kleine bureaus",
    submit: "Schrijf mijn voorbeeldzin",
    working: ["Website lezen…", "Feiten zoeken…", "Zin schrijven…"],
    resultLabel: "Voorbeeldopener voor {domain}",
    sourcesLabel: "Bronnen",
    cachedNote: "Uit een voorbeeld van de afgelopen 30 dagen.",
    cta: "Personaliseer 25 van je eigen leads gratis",
    limitNote: "3 pogingen per dag. Dit is een voorbeeld; in je campagne gebruik je je eigen e-mail en wordt elke zin gecontroleerd voordat je verstuurt.",
    testNote: "Testmodus: testtekst van een voorbeeldpagina, zonder AI.",
    errorGeneric: "Er ging iets mis. Probeer het opnieuw.",
    errorNetwork: "FirstLine is niet bereikbaar. Controleer je verbinding en probeer het opnieuw.",
  },

  integrations: { label: "Versturen of exporteren naar", names: ["Gmail", "Instantly", "Smartlead", "Lemlist", "n8n", "Make", "CSV"] },

  preview: {
    title: "Dit is de gratis preview",
    text: "Voordat een campagne draait, zie je 5 leads zoals hier: elk feit met de pagina waar het staat, de e-mail met de persoonlijke zin gemarkeerd, en de controles die hij doorstond.",
  },

  how: {
    eyebrow: "Zo werkt het",
    title: "Jouw e-mail. Hun website. Eén goede zin.",
    steps: [
      { time: "Ongeveer 1 minuut", title: "Upload je leads", text: "Een CSV met namen, bedrijven en websites. Wij schonen de domeinen op en halen dubbelingen eruit." },
      { time: "Ongeveer 2 minuten", title: "Plak je eigen e-mail", text: "Markeer de plekken die persoonlijk moeten, zoals [[opener]]. De rest blijft woord voor woord staan." },
      { time: "5 leads gratis, binnen minuten", title: "Wij lezen elke website", text: "FirstLine zoekt echte feiten op de eigen site van het bedrijf en schrijft alleen jouw gemarkeerde plekken. Je bekijkt eerst de gratis preview." },
      { time: "Tot 30 per dag per inbox", title: "Versturen of exporteren", text: "Verstuur vanuit je eigen Gmail met veilige limieten en follow-ups, of zet de resultaten door naar je verzendtool." },
    ],
  },

  trust: {
    eyebrow: "Gebouwd op vertrouwen",
    title: "Geen verzonnen feiten. Bij elke zin staat waar hij vandaan komt.",
    body: "Code en een AI-controleur kijken elke zin na voordat jij hem ziet. Algemene, verkoperige of ononderbouwde zinnen worden herschreven. Staat er niets bruikbaars op een website, dan krijgt de lead een neutrale zin en kost hij niets.",
    points: ["Elke bewering linkt naar de pagina", "Je aanbod en toon worden nooit herschreven", "Geen feiten gevonden, geen kosten"],
  },

  api: {
    eyebrow: "API, n8n en Make",
    title: "Persoonlijke zinnen in je eigen flow",
    body: "Stuur een lead, krijg een persoonlijke zin met bronnen terug. Dezelfde credits, dezelfde controles. Via de REST API, onze n8n-node of de Make-app.",
    cta: "Lees de API-documentatie",
  },

  pricing: {
    eyebrow: "Prijzen",
    title: "Betaal per e-mail. Verder niets.",
    sub: "Credits verlopen nooit. Alleen afgeronde e-mails kosten een credit. Versturen via Gmail en gewone follow-ups zijn gratis.",
    anchor: "300 e-mails ≈ €10 aan credits.",
    compare: {
      elsewhere: `Dezelfde 300 e-mails met een personalisatietool elders: ${range.currency}${range.min}–${range.max} per maand.`,
      us: "Met FirstLine: ongeveer €10 aan credits, eenmalig. Geen abonnement.",
      sourcesLabel: `Bronnen, gecontroleerd op ${checkedOnLabel(undefined, "nl")}`,
      sourcesNote:
        "Het goedkoopste abonnement op elke openbare prijspagina dat 300 AI-gepersonaliseerde e-mails per maand dekt, bij maandelijkse betaling zoals getoond (sommige pagina's tonen een lagere jaarprijs). Prijzen in de valuta van de pagina.",
    },
    perEmail: "per e-mail",
    packLine: (credits: string, price: string) => `${price} voor ${credits} e-mails`,
    save: (pct: number) => `${pct}% voordeliger`,
    anchorNote: "Het kleinste pakket is 500 credits voor €19.",
    refund: "Ongebruikte credits terug binnen 30 dagen na aankoop.",
    buy: (credits: string) => `Koop ${credits} credits`,
    mostPopular: "Aanbevolen",
    fit: {
      starter: "Om het op een echte campagne te proberen. Gaat ongeveer 2 maanden mee bij 300 e-mails per maand.",
      growth: "Voor vaste outreach. Gaat ruim een half jaar mee bij 300 e-mails per maand.",
      agency: "Voor meerdere klanten, of meer dan 2.000 e-mails per maand.",
    },
    perPack: "excl. btw · eenmalig",
    footnote: "Leads waarvan de website niets bruikbaars heeft, krijgen een neutrale zin en kosten geen credit. Economy-modus (resultaat binnen een paar uur) en extra onderzoeksopties vind je in de app.",
  },

  faq: {
    eyebrow: "Vragen",
    title: "Veelgestelde vragen",
    items: [
      { q: "Heb ik een abonnement nodig?", a: "Nee. Je koopt credits wanneer je ze nodig hebt en ze verlopen nooit. 1 credit = 1 gepersonaliseerde e-mail." },
      { q: "Kan ik het eerst proberen?", a: "Ja. Je krijgt 25 gratis credits zodra je je e-mailadres bevestigt, en elke campagne begint met een gratis preview van 5 leads." },
      {
        q: "Hoe werkt versturen via Gmail?",
        a: "Je kopieert een Google Sheet met een klein script naar je eigen Google-account. Dat verstuurt vanuit je inbox in een veilig tempo en stopt een reeks zodra iemand antwoordt. Wij krijgen nooit je wachtwoord.",
      },
      { q: "Scrapet FirstLine LinkedIn?", a: "Nee. Het onderzoek gebruikt alleen de openbare website van het bedrijf. Namen en functies komen uit je eigen lijst." },
      { q: "Welke talen?", a: "Nederlands en Engels, automatisch gekozen op basis van de taal van je e-mail." },
      {
        q: "Wordt mijn Gmail geblokkeerd?",
        a: "Niemand kan dat beloven, maar FirstLine verstuurt voorzichtig. Een nieuwe inbox begint met 10 e-mails per dag en groeit met 2 per dag tot 30. E-mails gaan 6 tot 14 minuten na elkaar de deur uit, op werkdagen binnen kantooruren, en het tempo gaat omlaag als meer dan 3% bouncet. We raden een apart domein voor outreach aan.",
      },
      {
        q: "Kan ik e-mails aanpassen voor ik ze verstuur?",
        a: "Je ziet eerst een gratis preview van 5 leads, met elk feit en de bron. Klopt een zin niet, pas dan je e-mail of de instructie voor die plek aan en draai de preview opnieuw. Losse e-mails aanpassen kan na export, in de CSV of je verzendtool; ze één voor één bewerken in FirstLine kan nog niet.",
      },
      {
        q: "En als een website niets bruikbaars heeft?",
        a: "Dan krijgt de lead een neutrale zin in plaats van een verzonnen zin, en kost hij 0 credits. Je betaalt alleen voor e-mails die echt gepersonaliseerd zijn.",
      },
      {
        q: "Is het AVG-proof?",
        a: "FirstLine is gemaakt voor rechtmatige B2B-outreach. Het onderzoek gebruikt alleen openbare bedrijfswebsites, nooit LinkedIn. Leadgegevens worden 30 dagen na het einde van een campagne verwijderd. Er is een verwerkersovereenkomst en de subverwerkers staan openbaar. Je hebt zelf wel een rechtsgrond nodig om je leads te mailen, zoals gerechtvaardigd belang.",
      },
      {
        q: "Waarom niet gewoon ChatGPT?",
        a: "Je kunt elke website zelf in ChatGPT plakken. Dat kost een paar minuten per lead, en niets controleert of de feiten kloppen. FirstLine leest de site voor je, laat bij elke zin de pagina zien, herschrijft algemene of verkoperige zinnen, en rekent niets als er niets bruikbaars is.",
      },
      {
        q: "Wat is het verschil met Instantly of Clay?",
        a: "Instantly en Lemlist zijn verzendplatforms; Clay is een werkbank voor data en onderzoek. FirstLine doet één ding: het leest de website van elke lead en schrijft de persoonlijke zinnen in jouw eigen e-mail, met bronnen, en je betaalt per e-mail. Het werkt ernaast: zet de resultaten door naar Instantly, Smartlead of Lemlist, of verstuur via Gmail.",
      },
    ],
  },

  honestLine: "Niet bedoeld om 50.000 e-mails per dag te versturen. Gemaakt voor wie antwoorden wil, geen volume.",
  founderNote: "Gebouwd door een team dat elke dag zelf cold outreach doet.",

  finalCta: {
    title: "25 gratis e-mails, geen creditcard, credits verlopen nooit.",
    sub: "Probeer het op je eigen leads.",
    cta: "Personaliseer 25 leads gratis",
  },

  objections: {
    eyebrow: "Voordat je begint",
    title: "Vier twijfels, beantwoord",
    items: [
      {
        q: "“AI-mails klinken nep.”",
        a: "FirstLine schrijft alleen de plekken die jij markeert, op basis van feiten van de eigen website van de lead. De rest is jouw e-mail, woord voor woord, en je bekijkt eerst 5 leads in een gratis preview.",
        link: { label: "Bekijk de preview", href: "#proof" },
      },
      {
        q: "“Mijn Gmail wordt geblokkeerd.”",
        a: "Een nieuwe inbox begint met 10 e-mails per dag en groeit naar 30, met 6 tot 14 minuten ertussen, binnen kantooruren. Het tempo gaat vanzelf omlaag als meer dan 3% bouncet.",
        link: { label: "Zo werkt versturen", href: "/nl/kleine-bedrijven#versturen" },
      },
      {
        q: "“Hoe zit het met de AVG?”",
        a: "Het onderzoek gebruikt alleen openbare bedrijfswebsites, nooit LinkedIn. Leadgegevens worden 30 dagen na het einde van een campagne verwijderd en de subverwerkers staan openbaar.",
        link: { label: "Vertrouwen en data (Engels)", href: "/trust" },
      },
      {
        q: "“Ik gebruik al Instantly.”",
        a: "Prima, houd het. FirstLine schrijft de persoonlijke zinnen en zet de afgeronde e-mails door naar Instantly, Smartlead of Lemlist. Het past naast de tool die je al hebt.",
        link: { label: "FirstLine en Instantly (Engels)", href: "/compare/instantly" },
      },
    ],
  },

  video: {
    eyebrow: "In 90 seconden",
    title: "Uploaden, bekijken, versturen",
    text: "Eén campagne van CSV tot de eerste e-mail in Gmail, zonder knippen.",
    label: "Video: een FirstLine-campagne van upload tot versturen",
  },

  caseStudy: {
    eyebrow: "Resultaten",
    before: "Reactiepercentage eerst",
    after: "Met FirstLine",
    basedOn: (n: string) => `op basis van ${n} e-mails`,
    placeholder: "Placeholder: nooit zichtbaar in productie",
  },

  proof: {
    counter: "{personalised} e-mails gepersonaliseerd · {neutral} leads gratis overgeslagen",
    counterNote: "Live uit de database van FirstLine, elk uur bijgewerkt.",
    counterPreview: "Preview: de drempel wordt lokaal genegeerd",
    testimonialsEyebrow: "Van mensen die het gebruiken",
    testimonialsTitle: "In hun eigen woorden",
    logosLabel: "Gebruikt door teams van",
    placeholder: "Placeholder: nooit zichtbaar in productie",
  },

  visuals: {
    leads: [
      { name: "Sanne de Vos", company: "Bakkerij Vos", site: "bakkerijvos.nl", status: "Geschreven · hoog", tone: "brand", facts: "4" },
      { name: "Joris Bakker", company: "Het Zuurdesemhuis", site: "zuurdesemhuis.nl", status: "Geschreven · hoog", tone: "brand", facts: "6" },
      { name: "Lotte Peters", company: "Broodhuys Oost", site: "broodhuys.nl", status: "Schrijven…", tone: "blue", facts: "3" },
      { name: "Mark Smit", company: "De Korenaar", site: "dekorenaar.nl", status: "Website lezen…", tone: "blue", facts: "–" },
      { name: "Eva Jansen", company: "Bakkerij Jansen", site: "bakkerijjansen.nl", status: "Neutrale zin · gratis", tone: "gray", facts: "0" },
    ],
    windowTitle: "Campagnes › Bakkerijen Utrecht · Preview",
    campaign: "Bakkerijen Utrecht",
    campaignMeta: "5 van 240 leads · gratis preview",
    written: "4 geschreven",
    neutral: "1 neutraal · 0 credits",
    columns: ["Lead", "Website", "Status", "Feiten"],
    factsWord: "feiten",
    emailMeta: "Aan sanne@bakkerijvos.nl · Onderwerp: Vraagje over Utrecht-Oost",
    signOff: "Tom",
    sourcesTitle: "Bronnen op bakkerijvos.nl",
    used: "gebruikt",
    reviewer: "Controle: specifiek, onderbouwd, niet verkoperig",
    templateLines: ["Hoi {{first_name}},", "Wij helpen bakkerijen minder weg te gooien…"],
    readRows: [
      ["bakkerijvos.nl/", "gelezen"],
      ["/over-ons", "gelezen"],
      ["/nieuws", "2 feiten"],
    ],
    sendRows: [
      ["Gmail · 30 per dag", "verzenden"],
      ["Follow-up na 3 dagen", "in de wachtrij"],
      ["Antwoord ontvangen", "reeks stopt"],
    ],
    apiLabel: "Voorbeeld van een API-verzoek en antwoord",
    demoLabel: "Voorbeeld: een feit op de website van het bedrijf wordt de persoonlijke zin in je e-mail, met de bron",
  },

  checkedOn: (date: string) => `Gecontroleerd op ${date}. Prijzen veranderen; volg de links voor de actuele prijzen.`,
  perMonth: "maand",
};
