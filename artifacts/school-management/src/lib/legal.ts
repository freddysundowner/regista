/**
 * The Terms and the Privacy Policy shown at /terms and /privacy, and accepted when an account is created.
 * Change LEGAL_VERSION (and the server's TERMS_VERSION) whenever the wording changes, so each acceptance
 * on record says which wording it was.
 */
export const LEGAL_VERSION = "2026-10-12";
export const LEGAL_UPDATED = "12 October 2026";

export type LegalSection = { title: string; body: string[]; points?: string[] };
export type LegalDoc = { slug: "terms" | "privacy"; title: string; heading: string; description: string; intro: string; sections: LegalSection[] };

export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms and conditions · Rejista",
  heading: "Terms and conditions",
  description: "The terms for using Rejista, the school management system: accounts, subscriptions and payment, your school's data, acceptable use and liability.",
  intro: "These terms are the agreement between Rejista and the school that opens an account. By creating an account you accept them on behalf of your school.",
  sections: [
    { title: "1. The service", body: [
      "Rejista is an online system for running a school: learner records, classes, fees and billing, payments, attendance, marks, report cards, staff accounts and messages to parents.",
      "We keep improving it, so screens and features change over time. We will not remove something a school depends on without notice.",
    ] },
    { title: "2. Your account", body: [
      "The person who creates the account becomes the school's administrator and confirms that they are allowed to act for the school.",
    ], points: [
      "Give accurate details, and keep them up to date.",
      "Keep passwords private. Each member of staff uses their own sign-in; do not share one account.",
      "The administrator decides who at the school gets access and what they can do, and removes access when someone leaves.",
      "Tell us straight away if you think someone has got into an account who should not have.",
    ] },
    { title: "3. Free trial, packages and payment", body: [
      "A new school may start on a free trial. The length of the trial and the current prices are shown on the pricing section of our website and on your Subscription page.",
      "After the trial, the school pays for a package sized to its number of learners. Payment is made in advance for each period, in Kenya shillings.",
    ], points: [
      "When a school grows past its package, it moves to a larger one and pays the difference for the days left in the period.",
      "If a subscription is not renewed, access to the system is limited until it is. Your records are not deleted because a payment is late.",
      "Payments for a period that has started are not refunded, except where the law requires it.",
      "We may change prices for future periods. A change never applies to a period you have already paid for.",
    ] },
    { title: "4. Your school's data", body: [
      "Everything your school enters belongs to your school. We handle it only to provide the service, as set out in the Privacy Policy.",
      "The school is responsible for having the right to hold the information it enters about learners, parents and staff, and for its accuracy.",
      "You can export your records from the system. If you close your account, ask us for a copy of your data before it is removed.",
    ] },
    { title: "5. Payments from parents", body: [
      "Rejista records and matches fee payments. The money itself moves through M-Pesa, your bank or another payment provider, straight to the school's own account. We do not hold school fees.",
      "Those providers have their own terms and charges, which apply to the school. We are not responsible for a provider's delays, reversals or outages, though we will help you trace a payment.",
    ] },
    { title: "6. Messages to parents", body: [
      "SMS, WhatsApp and email are sent on the school's behalf. The school is responsible for what it sends and for sending only to people who should receive it.",
      "Delivery depends on mobile networks and messaging providers, so we cannot promise that every message arrives.",
    ] },
    { title: "7. Acceptable use", body: ["You agree not to:"], points: [
      "use the system for anything unlawful, or to hold records you have no right to hold;",
      "try to reach another school's data, or test or get around the system's security;",
      "copy, resell or reverse engineer the system;",
      "overload it with automated requests, or use it to send spam.",
    ] },
    { title: "8. Availability and support", body: [
      "We work to keep Rejista available at all times, but we do not promise it will never be interrupted. Maintenance, internet faults and problems at providers we rely on can cause downtime.",
      "Help is available through the support chat inside the system and on our website.",
    ] },
    { title: "9. Our responsibility to you", body: [
      "We provide the service with reasonable care and skill. Beyond that, and as far as the law allows, it is provided as it is.",
      "We are not liable for indirect losses, lost income, or losses caused by wrong information entered by the school or by a third party's service. Our total liability to a school in any twelve months is limited to what that school paid us in those twelve months.",
      "Nothing in these terms limits liability that cannot be limited by law.",
    ] },
    { title: "10. Ending the agreement", body: [
      "A school can stop using Rejista at any time by not renewing, or by asking us to close the account.",
      "We may suspend or close an account that breaks these terms, puts other schools at risk, or stays unpaid. Where we can, we give notice first and a chance to put things right.",
    ] },
    { title: "11. Changes to these terms", body: [
      "We may update these terms. When a change matters, we tell the school's administrator before it takes effect. Carrying on using the system after that means the school accepts the new terms.",
    ] },
    { title: "12. Law", body: [
      "These terms are governed by the laws of Kenya, and the courts of Kenya settle any dispute about them.",
    ] },
    { title: "13. Contact", body: [
      "Questions about these terms can be sent through the support chat on our website or inside the system.",
    ] },
  ],
};

export const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy policy · Rejista",
  heading: "Privacy policy",
  description: "How Rejista handles personal data about school staff, learners and parents, in line with Kenya's Data Protection Act, 2019.",
  intro: "This policy explains what personal information Rejista handles, why, and the choices people have. It is written to meet Kenya's Data Protection Act, 2019.",
  sections: [
    { title: "1. Who is responsible", body: [
      "A school that uses Rejista decides what information it keeps about its learners, parents and staff. The school is the data controller for those records, and Rejista handles them on the school's instructions, as its data processor.",
      "For the details of the people who open and manage an account with us, and visitors to our website, Rejista is the data controller.",
    ] },
    { title: "2. What we handle", body: [], points: [
      "Account details: the name, email address, phone number and role of each person who signs in, and a protected (hashed) form of their password.",
      "School records entered by the school: learners' names, admission numbers, classes, dates of birth, attendance, marks and report cards; parents' and guardians' names and contact details; fee bills, balances and payments.",
      "Payment details received from M-Pesa, banks and other providers so that a payment can be matched to a learner: amount, date, reference, and the payer's name and phone number where the provider sends them.",
      "Messages sent through the system, and their delivery status.",
      "Technical records: sign-in times, the device and internet address used, and a log of who changed what, kept for security and accountability.",
      "Support conversations, when someone writes to us in the chat.",
    ] },
    { title: "3. Why we handle it", body: [], points: [
      "To provide the service the school has signed up for.",
      "To keep accounts and school records secure, and to investigate misuse.",
      "To bill the school for its subscription.",
      "To answer questions and fix problems.",
      "To meet legal duties.",
    ] },
    { title: "4. Children's information", body: [
      "Most learners are children. Their information is entered by the school, which is responsible for having a parent's or guardian's consent, or another lawful reason, for keeping it. We handle it only so the school can run, never for advertising or profiling.",
    ] },
    { title: "5. Who we share it with", body: [
      "We do not sell personal information. We pass it on only where the service needs it:",
    ], points: [
      "payment providers, such as Safaricom M-Pesa, banks and payment gateways, to receive and confirm payments;",
      "messaging providers, to deliver SMS, WhatsApp and email on the school's behalf;",
      "hosting and infrastructure providers that store and run the system;",
      "an AI provider that helps answer questions in the support chat. Only what is typed in the chat is sent, so please do not put learners' personal details in it;",
      "authorities, where the law requires it.",
    ] },
    { title: "6. Where it is kept and how it is protected", body: [
      "Each school's records are kept separate from every other school's. Access needs a sign-in, permissions limit what each member of staff can see and do, passwords are stored hashed, connections are encrypted, and changes are logged.",
      "Some of the providers we use may store or process data outside Kenya. Where that happens, we rely on the safeguards the law requires.",
      "No system is perfectly secure. If a breach affects personal data, we will tell the school and the Data Protection Commissioner as the law requires.",
    ] },
    { title: "7. How long we keep it", body: [
      "We keep a school's records for as long as its account is open. After an account is closed, records are removed or made anonymous within a reasonable time, unless the law requires us to keep them for longer, as it does for some financial records.",
    ] },
    { title: "8. Your rights", body: [
      "Under the Data Protection Act you can ask to see the personal information held about you, have it corrected, object to how it is used, and ask for it to be deleted where there is no reason to keep it.",
      "Parents, learners and staff should ask the school first, since the school controls its own records and has tools in the system to export, correct or anonymise them. Account holders can ask us directly.",
      "You can also complain to the Office of the Data Protection Commissioner.",
    ] },
    { title: "9. Cookies", body: [
      "We use a sign-in cookie to keep you signed in, and store a few preferences in your browser. We do not use advertising cookies.",
    ] },
    { title: "10. Changes and contact", body: [
      "We may update this policy, and will tell school administrators about changes that matter.",
      "Questions and requests about personal data can be sent through the support chat on our website or inside the system.",
    ] },
  ],
};

export const LEGAL: Record<LegalDoc["slug"], LegalDoc> = { terms: TERMS, privacy: PRIVACY };
