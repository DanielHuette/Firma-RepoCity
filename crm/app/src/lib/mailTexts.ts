// Rules a mail text must keep before it is saved.
import type { MailTextKey } from "../api/types";

const OPT_OUT = "{{abmeldelink}}";
const NEEDS_OPT_OUT: MailTextKey[] = ["follow_up_1", "follow_up_2"];

// The links the customer books with or asks for another time, as crm.book_audit_appointment and
// crm.send_audit_proposal fill them in.
const NEEDS_LINKS: Partial<Record<MailTextKey, [string, string]>> = {
  audit_confirmation: ["{{umbuchungslink}}", "einen anderen Termin wünschen kann"],
  audit_rebooking: ["{{umbuchungslink}}", "einen anderen Termin wünschen kann"],
  audit_proposal: ["{{vorschlaege}}", "einen Termin buchen kann"],
};

export function mailTextProblem(key: MailTextKey, subject: string, body: string): string | null {
  if (subject.trim() === "" || body.trim() === "") return "Betreff und Text dürfen nicht leer sein.";
  if (NEEDS_OPT_OUT.includes(key) && !body.includes(OPT_OUT)) {
    return `Der Text muss den Platzhalter ${OPT_OUT} enthalten, damit der Kunde Erinnerungen abbestellen kann.`;
  }
  const link = NEEDS_LINKS[key];
  if (link !== undefined && !body.includes(link[0])) return `Der Text muss den Platzhalter ${link[0]} enthalten, damit der Kunde ${link[1]}.`;
  return null;
}
