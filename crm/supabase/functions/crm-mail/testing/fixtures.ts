// Shared test data: an invented seller and customer, never real business data.
import type { Party, Seller } from "../pdf/model.ts";

export const seller: Seller = {
  company_name: "Beispielfirma", owner_name: "Erika Beispiel", street: "Musterweg 1", postal_code: "48143", city: "Münster",
  country_code: "DE", email: "post@beispiel.test", phone: "0251 000000", website: "beispiel.test", tax_number: "337/5000/0000",
  vat_id: "", iban: "DE02 1203 0000 0000 2020 51", bic: "BYLADEM1001", bank_name: "Beispielbank",
};

export const customer: Party = {
  kind: "company", name: "Bäckerei Größe GmbH", contact_person: "Jürgen Weiß", street: "Hauptstraße 5", postal_code: "48143",
  city: "Münster", country_code: "DE", vat_id: "", buyer_reference: "",
};
