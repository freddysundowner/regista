/** The three ways a teacher is tied to a class, and what each one lets them do. Mirrors the API's access rules. */
export const KIND_LABEL: Record<string, string> = { subject: "Subject teacher", class_teacher: "Class teacher", stream_access: "View only" };
export const KIND_HELP: Record<string, string> = {
  subject: "Enters marks for the chosen subjects in this class, for one term.",
  class_teacher: "Marks the register, gives ratings and writes report cards for the whole class.",
  stream_access: "Sees the class and its learners. Cannot mark attendance or enter marks.",
};
export const KIND_TONE: Record<string, string> = {
  class_teacher: "bg-primary/10 text-primary border-primary/25",
  stream_access: "bg-stone-500/10 text-stone-700 border-stone-500/20",
  subject: "bg-amber-600/15 text-amber-900 border-amber-700/25",
};
export const KIND_ORDER = ["subject", "class_teacher", "stream_access"] as const;
