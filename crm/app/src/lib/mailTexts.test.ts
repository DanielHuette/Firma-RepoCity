import { describe, expect, it } from "vitest";
import { mailTextProblem } from "./mailTexts";

describe("mailTextProblem", () => {
  it("keeps the opt-out link in both follow-up mails", () => {
    expect(mailTextProblem("follow_up_1", "Betreff", "Hallo")).toBe("Der Text muss den Platzhalter {{abmeldelink}} enthalten, damit der Kunde Erinnerungen abbestellen kann.");
    expect(mailTextProblem("follow_up_2", "Betreff", "Hallo {{abmeldelink}}")).toBeNull();
  });

  it("keeps the links the customer books with in the mails of audit requests", () => {
    expect(mailTextProblem("audit_confirmation", "Termin", "Am {{termin}}")).toBe("Der Text muss den Platzhalter {{umbuchungslink}} enthalten, damit der Kunde einen anderen Termin wünschen kann.");
    expect(mailTextProblem("audit_proposal", "Vorschläge", "Hallo")).toBe("Der Text muss den Platzhalter {{vorschlaege}} enthalten, damit der Kunde einen Termin buchen kann.");
    expect(mailTextProblem("audit_confirmation", "Termin", "{{umbuchungslink}}")).toBeNull();
    expect(mailTextProblem("audit_proposal", "Vorschläge", "{{vorschlaege}}")).toBeNull();
    expect(mailTextProblem("appointment_reminder", "Morgen", "Bis morgen")).toBeNull();
    expect(mailTextProblem("audit_rebooking", "Neu", "Neu am {{termin}}")).toBe("Der Text muss den Platzhalter {{umbuchungslink}} enthalten, damit der Kunde einen anderen Termin wünschen kann.");
    expect(mailTextProblem("audit_cancellation", "Absage", "Entfällt")).toBeNull();
  });

  it("needs no opt-out link in other mails", () => {
    expect(mailTextProblem("appointment", "Termin {{termin}}", "Am {{termin}}")).toBeNull();
  });

  it("refuses an empty subject or text", () => {
    expect(mailTextProblem("quote", " ", "Text")).toBe("Betreff und Text dürfen nicht leer sein.");
    expect(mailTextProblem("quote", "Betreff", "")).toBe("Betreff und Text dürfen nicht leer sein.");
  });
});
