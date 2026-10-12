/**
 * The user manual shown at /manual. Written against the screens as they are: page names, tabs and buttons below
 * are the labels people actually see. Keep it that way when a screen changes.
 */
export type ManualTopic = { title: string; who?: string; intro?: string; steps?: string[]; notes?: string[] };
export type ManualChapter = { id: string; title: string; summary: string; topics: ManualTopic[] };

export const MANUAL: ManualChapter[] = [
  {
    id: "getting-started", title: "Getting started", summary: "From a new account to a school that is ready to use.",
    topics: [
      { title: "Create your account", steps: [
        "On the Rejista home page choose Start free trial (or Get started).",
        "Enter your name, your email and a password of at least 6 characters.",
        "You are signed in as the school's first administrator. Add the school's name, level and county when asked.",
      ], notes: ["If new schools are reviewed before opening, you can sign in to see the status of your registration while you wait."] },
      { title: "Set the school up in order", intro: "Home shows a Getting started list that ticks itself off as you go. The order that works best:", steps: [
        "Terms: create the academic year and its terms, and mark the current term.",
        "Classes: add your grades and the classes (streams) in each, and pick a class teacher where you have one.",
        "Fee setup: enter what each grade pays for the term.",
        "Learners: admit learners one by one or import the whole register from Excel.",
        "Staff: add the bursar, principal, teachers and anyone else who needs to sign in.",
        "Settings: connect M-Pesa or your bank so payments match to learners by themselves.",
      ] },
      { title: "Signing in", steps: [
        "Go to Sign in and enter your email or phone number and your password.",
        "Forgot it? Choose Forgot password?, enter your email, and open the link that is emailed to you. It works once, for one hour.",
      ], notes: ["Staff whose account has only a phone number ask their school administrator to reset the password from the Staff page."] },
    ],
  },
  {
    id: "roles", title: "Who can do what", summary: "Each person signs in with their own account and sees only their own work.",
    topics: [
      { title: "The roles", notes: [
        "School admin: everything, including staff, settings and money.",
        "Principal: sees learners, money and reports; approves fee changes and LPOs.",
        "Bursar: fees, payments, expenses and purchasing.",
        "Teacher: marks and attendance for the classes they teach.",
        "Class teacher: like a teacher, plus their own class register.",
        "Storekeeper: only the store. Librarian: only the library.",
      ] },
      { title: "Add a staff member", who: "School admin", steps: [
        "Open Staff and choose Add staff.",
        "Enter their name and an email or phone number; they sign in with one of them.",
        "Pick a role and type a temporary password to share with them privately.",
        "Tick any extra access they need on top of the role, for example a teacher who also runs the library.",
      ] },
      { title: "Reset or switch off an account", who: "School admin", steps: [
        "Open Staff. The key icon beside a person sets a new temporary password and signs them out everywhere.",
        "Deactivate stops someone signing in without deleting their history; Reactivate brings them back.",
      ] },
      { title: "Your own account", steps: ["Click your name at the bottom of the menu and choose My account to change your password."] },
    ],
  },
  {
    id: "learners", title: "Learners and families", summary: "The register, guardians, and bringing your records in.",
    topics: [
      { title: "Admit one learner", who: "School admin or bursar", steps: [
        "Open Learners and choose Admit student.",
        "Fill in the learner's details, grade and class, then add a guardian with their phone number.",
      ], notes: ["Brothers and sisters are linked into one family automatically when they share a guardian's phone number."] },
      { title: "Import the whole register", who: "School admin or bursar", steps: [
        "Open Learners, then the Import tab.",
        "Download the template, fill it in Excel with your learners and guardians, and upload it.",
        "Rejista checks every row and shows any problems. Nothing is saved until you confirm.",
      ] },
      { title: "Guardians and families", steps: [
        "Open Learners, then the Families tab, to see guardians and the children linked to each.",
        "Use Add guardian or Edit guardian to keep phone numbers current: payments and messages depend on them.",
      ], notes: ["A guardian can ask for a copy of their data (Export data) or to be removed from it (Anonymize); both are on the Families tab."] },
      { title: "A learner leaves", steps: [
        "Open the learner and change their status to Transferred, Graduated or Left. Their history stays.",
        "Removing a learner completely is for mistakes; a school admin does it from the learner's page by typing the admission number to confirm.",
      ] },
      { title: "Moving everyone up at year end", who: "School admin", steps: [
        "Use Year-end promotion to move each class to the next grade.",
        "You see a preview of who moves where, and type PROMOTE to commit.",
      ] },
    ],
  },
  {
    id: "school", title: "Terms, classes and subjects", summary: "The structure everything else hangs on.",
    topics: [
      { title: "Terms", who: "School admin", steps: ["Open Terms. Add the academic year, then each term with its opening and closing dates.", "Mark the term that is running now as the current term."] },
      { title: "Classes", who: "School admin", steps: ["Open Classes. Add each grade, then the classes (streams) inside it, such as Grade 4 East.", "Choose a class teacher for each class: they take its register and write its report-card comments."] },
      { title: "Subjects and rating scales", steps: ["Open Subjects to add the subjects each grade takes and their topics.", "Rejista comes with 4-level and 8-level rubric scales you can edit, or you can create your own."] },
      { title: "Who teaches what", who: "School admin", steps: ["Open Teacher assignments and choose Assign teacher.", "Pick the teacher, the class and the term. Teachers only see the classes they are assigned."] },
    ],
  },
  {
    id: "fees", title: "Fees and billing", summary: "Set what each grade pays, bill the term, and follow up on balances.",
    topics: [
      { title: "Set the fees", who: "School admin or bursar", steps: [
        "Open Fee setup. On the Fees tab enter the amount each grade pays for each fee item this term.",
        "The Fee structure tab gives you a printable fee structure to share with parents.",
      ], notes: ["Once the school has billed learners, a change to fees waits for a second person to approve it, unless the school has switched that rule off in Settings."] },
      { title: "Bill learners for the term", who: "School admin or bursar", steps: [
        "Open Fees & balances, then the Invoices tab, and choose Generate term invoices.",
        "Pick the term and a due date. You get a preview of every learner's invoice.",
        "Confirm to post them. Learners already billed for that term are skipped, so it is safe to run again after new admissions.",
      ] },
      { title: "A charge for one learner", steps: ["On the Invoices tab choose One-off invoice, pick the learner and the fee item, and post it."] },
      { title: "See who owes", steps: [
        "Open Fees & balances. Who owes lists every learner with a balance, what is from past terms, and when they last paid.",
        "Use the filters to narrow it down: owes over 10k, not reminded this week, promise broken, and so on.",
        "Export the list to Excel or CSV.",
      ] },
      { title: "Remind parents and record promises", steps: [
        "Tick learners on Who owes and send a reminder to their parents.",
        "Use Promise on a row to record the date a parent said they will pay. Broken promises show up in their own filter.",
      ] },
      { title: "Discounts, bursaries, refunds and corrections", intro: "These change what a learner owes, so each one is a request that a second person approves.", steps: [
        "The bursar raises the request with a reason.",
        "A principal or school admin opens Approvals, reviews it and approves or rejects it. Nobody can approve their own request.",
      ], notes: ["A school that has switched off second-person approval in Settings has these applied as soon as they are saved. Either way, every one is in the audit log."] },
    ],
  },
  {
    id: "payments", title: "Payments", summary: "How money comes in and lands on the right learner.",
    topics: [
      { title: "Record a payment by hand", who: "Bursar", steps: [
        "On Home choose Record a payment, or open Payments and choose Add a payment.",
        "Pick the learner, enter the amount and how it was paid: M-Pesa, bank, cash or cheque.",
        "Save. The learner's balance updates and a receipt is ready to download.",
      ], notes: ["A cheque is followed through its stages (received, banked, cleared). If it bounces, the payment is reversed after approval."] },
      { title: "M-Pesa with your own Daraja account", who: "School admin", steps: [
        "Open Settings, then M-Pesa, and choose Configure on M-Pesa Daraja.",
        "Enter the paybill or till shortcode and the keys Safaricom gave you, then Register callbacks.",
        "Parents pay to your paybill using the learner's admission number as the account number.",
      ] },
      { title: "M-Pesa through SunPay", who: "School admin", intro: "For schools without a Daraja account, using the till or paybill they already have.", steps: [
        "Open Settings, then M-Pesa. Under Or collect through SunPay choose till or paybill, enter the number and Connect.",
        "Parents pay from the M-Pesa menu: Pay Bill, the SunPay business number shown on that page, and your number followed by # and the admission number as the account.",
        "Or send a prompt to the parent's phone from Payments with Send M-Pesa prompt.",
      ], notes: ["SunPay keeps 1.5% of each payment and sends the rest to your till or paybill. The learner is credited with the full amount the parent paid."] },
      { title: "Bank payments", who: "School admin", steps: [
        "Open Settings, then Bank, and choose Add bank. Enter the account parents pay into.",
        "For NCBA and KCB, Rejista prepares the request letter that asks the bank to send payment notifications. Sign it and take it to your branch.",
        "For any other bank, the bursar records deposits by hand or imports a bank statement on the Payments page.",
      ] },
      { title: "How payments match to learners", notes: [
        "A payment that carries the admission number goes straight to that learner and gets a receipt.",
        "With no admission number, Rejista tries the payer's phone number against guardians. One child: it posts. Several children: the parent or the bursar chooses how to split it.",
        "Anything it is not sure about waits under Payments, Needs a learner, for the bursar to assign.",
        "Very large payments and payments with odd dates are always held for the bursar to confirm first.",
      ] },
      { title: "Receipts and statements", steps: ["Open a payment to download its receipt.", "Open a learner to see their full fee history and download a statement."] },
    ],
  },
  {
    id: "spending", title: "Expenses, purchasing, store and library", summary: "What the school spends and what it keeps.",
    topics: [
      { title: "Record an expense", who: "Bursar, or anyone given Expenses access", steps: ["Open Expenses and add the date, who was paid, the amount and how it was paid.", "Attach the receipt if you have one. An expense entered by mistake is voided, not deleted."] },
      { title: "Buying with an LPO", steps: [
        "Add your suppliers under Expenses, Suppliers.",
        "Raise an LPO under Expenses, LPOs. It waits for the principal or an admin to approve it.",
        "When goods arrive, record what was delivered against the LPO.",
        "Enter the supplier's invoice under Supplier invoices and use Pay when it is paid; that payment appears in Expenses.",
      ] },
      { title: "The store", who: "Storekeeper", steps: ["Open Store and use Add item for each thing you stock.", "Record stock coming in and going out; Stock in & out shows every movement and each item has its own stock card."] },
      { title: "The library", who: "Librarian", steps: ["Open Library and use Add book, then Add copies; each copy gets an accession number.", "Lend a book to a learner or member of staff with a due date, and use Return when it comes back.", "Borrowed books lists everything out and what is overdue."] },
    ],
  },
  {
    id: "classwork", title: "Attendance, marks and report cards", summary: "The teacher's daily work.",
    topics: [
      { title: "Take the register", who: "Class teacher", steps: [
        "Open Classwork, then Attendance, and pick your class.",
        "Everyone starts as present. Change only the learners who are absent, late or excused.",
        "Tick that you have checked everyone and choose Submit register.",
      ] },
      { title: "Enter marks", who: "Teachers", steps: [
        "Open Classwork, then Marks. Choose New assessment and give it a name, date and what it is marked out of.",
        "Type each learner's mark in the grid and save.",
        "Lock the assessment when the marks are final. Only an administrator can unlock it, with a reason.",
      ] },
      { title: "Report cards", steps: [
        "Open Classwork, then Report cards, and choose a class and term.",
        "The class teacher writes a comment for each learner; the principal or an admin adds the head teacher's remarks and the date next term opens.",
        "Publish a report card to freeze it. Published cards can be downloaded as PDFs, one at a time or for the whole class, and sent to the family.",
      ], notes: ["Report cards are never held back because of a fee balance by the system; that decision stays with the school."] },
    ],
  },
  {
    id: "reports", title: "Reports and the Finance Book", summary: "Answers about money and results without building a spreadsheet.",
    topics: [
      { title: "Finance Book", steps: ["Open Finance Book for the term in plain questions: how much should come in, how much has, who owes, what was spent, and which classes are furthest behind."] },
      { title: "Run a report", steps: [
        "Open Reports and pick the type: collections, collections by fee item, fee balances, defaulters, arrears by age, payment plans, discounts and adjustments, learner statement, class results or attendance.",
        "Set the dates or grade and choose Run report.",
        "Export to PDF or Excel. The export contains exactly the rows you see.",
      ] },
      { title: "Audit log", who: "School admin or principal", steps: ["Open Settings, then Audit log, to see every create, edit and import, who did it and when."] },
    ],
  },
  {
    id: "messages", title: "Messages to parents", summary: "Receipts, reminders and notices by SMS, WhatsApp and email.",
    topics: [
      { title: "Set up sending", who: "School admin", steps: [
        "Open Settings, then Messaging, and choose for SMS and WhatsApp either the shared Rejista account or your school's own.",
        "Open Settings, then Email, to connect your school's own email account.",
      ] },
      { title: "Send a message", steps: ["Open Messages and choose Message a parent. Find the parent, pick the kind of message and how to send it.", "Sent messages lists what went out and whether the provider accepted it."] },
    ],
  },
  {
    id: "subscription", title: "Your subscription", summary: "The free trial, paying, and licence keys.",
    topics: [
      { title: "Subscribe or renew", who: "School admin", steps: [
        "Open Subscription. It shows the days left and the current price.",
        "Choose Subscribe or Renew and pay by one of the methods offered, or pay Rejista directly and quote the invoice number.",
        "Have a licence key? Choose I have a licence key and enter it; its time is added after any time you already have.",
      ], notes: ["When a subscription runs out, the school's records are kept safe and open again as soon as it is renewed."] },
    ],
  },
  {
    id: "help", title: "Getting help", summary: "Answers without leaving the page you are on.",
    topics: [
      { title: "The help chat", steps: [
        "Inside Rejista, tap the green chat button in the corner of any page.",
        "Tap one of the questions or type your own. The assistant answers from Rejista's own knowledge base.",
        "If it can't answer, your question goes to the Rejista team and the reply appears in the same chat.",
      ] },
    ],
  },
];
