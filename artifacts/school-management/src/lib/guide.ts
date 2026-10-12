import type { OnboardingStepId } from "@workspace/api-client-react";

/** Setup steps in the order a new school should do them. Completion is detected by the server. */
export const SETUP_STEPS: Record<OnboardingStepId, { title: string; why: string; cta: string; href: string }> = {
  profile: { title: "Add your school's details", why: "Your phone, email and logo appear on receipts, statements and report cards.", cta: "Open settings", href: "/" },
  calendar: { title: "Set the academic year and terms", why: "Fees, attendance and results are all recorded per term.", cta: "Set up the year", href: "/" },
  classes: { title: "Add grades and streams", why: "Learners are placed in a stream, and teachers are assigned to streams.", cta: "Add classes", href: "/" },
  learners: { title: "Add your learners", why: "Upload your register from Excel, or add learners one at a time. Guardians and siblings link up automatically.", cta: "Add learners", href: "/students" },
  staff: { title: "Invite your staff", why: "Give the bursar, teachers and principal their own sign-in, each seeing only what their role needs.", cta: "Add staff", href: "/" },
  fees: { title: "Set your fees", why: "Create fee items, such as tuition or transport, and the amounts for each grade and term.", cta: "Set fees", href: "/" },
  invoices: { title: "Bill learners for this term", why: "Turn your fee structure into invoices, so every learner has a balance parents can see.", cta: "Bill learners", href: "/term-setup?step=billing" },
  collections: { title: "Collect fees by M-Pesa", why: "Connect your paybill so payments match to learners and receipts go out automatically.", cta: "Connect M-Pesa", href: "/" },
  curriculum: { title: "Set up subjects", why: "Add each grade's subjects and the CBC rating scales, so teachers can enter marks.", cta: "Set up subjects", href: "/subjects" },
  parents: { title: "Reach parents by SMS or WhatsApp", why: "Send fee reminders and let parents check balances and results on WhatsApp.", cta: "Connect messaging", href: "/" },
};
