"""Every text of the company page, German and English side by side.

Context: Each statement comes from the files of this repository named in the part's
``quellen``; nothing here is estimated. | Input: none. | Output: FIRMA and TEILE, the
records seite.py renders.
"""

from __future__ import annotations

from modell import (
    Anruf,
    Blatt,
    Firma,
    Handy,
    Karte,
    Kette,
    Link,
    Liste,
    Marke,
    Mitteilungen,
    Nabe,
    SkillGruppe,
    Station,
    Szene,
    T,
    Teil,
    Verbindung,
    gleich,
)

GITHUB = "https://github.com/DanielHuette/Firma-RepoCity"

EIGENER_SERVER = T(
    "eigener Server der Firma, dafür gebaut",
    "the company's own server, built for it",
)
DATENBANK_CRM = T("Datenbank des CRM", "CRM database")
ZEITPLAN = T("Zeitplan in der Datenbank", "schedule in the database")

PREACT = T("Preact und TypeScript", "Preact and TypeScript")
WEB_APP = T(
    "Installierbare Web-App (Progressive Web App)",
    "Installable web app (progressive web app)",
)
ZEILENRECHTE = T("Zeilenrechte (Row Level Security)", "Row level security")
DENO = T("Edge Function in Deno", "Edge Function in Deno")


def github_ordner(pfad: str) -> Link:
    """Return the link to one folder of the repository on GitHub."""
    url = f"{GITHUB}/tree/main/{pfad}"
    return Link(T("Code auf GitHub", "Code on GitHub"), gleich(url))


BEREICHE = (
    T("Technik der Website", "Website technology"),
    T("Aufbau der Seiten", "Page structure"),
    T("Inhalte und Leistungsseiten", "Content and service pages"),
    T("Firmendaten auf der Website", "Business details on the website"),
    T("Unsichtbare Angaben für Google und KI", "Hidden data for Google and AI"),
    T("Google-Unternehmensprofil", "Google Business Profile"),
    T("Bewertungen", "Reviews"),
    T("Verzeichnisse und Einträge", "Directories and listings"),
    T("Empfehlungen durch Links", "Recommendations through links"),
    T("Platzierung bei Google und Bing", "Ranking on Google and Bing"),
    T("Sichtbarkeit in KI-Assistenten", "Visibility in AI assistants"),
    T("Recht und Vertrauen", "Law and trust"),
    T("Werkzeuge auf der Website", "Tools on the website"),
    T("Wirkung mit Kundenzugang", "Impact with customer access"),
)

FIRMA = Firma(
    titel=gleich("RepoCity"),
    beschreibung=T(
        "RepoCity ist eine Firma, deren Software den Ablauf größtenteils selbst erledigt: CRM, "
        "Cockpit, RadarAuditor, Marketing, Telefonassistentin, Mail-Eingang und Webseiten-Service. "
        "Daniel Hütte steuert und gibt frei.",
        "RepoCity is a company whose software runs most of the work by itself: CRM, Cockpit, "
        "RadarAuditor, marketing, phone assistant, incoming mail and website service. "
        "Daniel Hütte steers and approves.",
    ),
    satz=T(
        "Eine Firma, deren Software den Ablauf größtenteils selbst erledigt. "
        "Daniel Hütte steuert, prüft und gibt frei.",
        "A company whose software runs most of the work by itself. Daniel Hütte steers, checks and approves.",
    ),
    stand=T("Teststand ohne Kundenbetrieb.", "Test stage without customer operation."),
    film_titel=T("RepoCity in acht Szenen", "RepoCity in eight scenes"),
    szenen=(
        Szene(
            gleich("RepoCity"),
            T(
                "Eine Firma, deren Software den Ablauf größtenteils selbst erledigt. Daniel steuert und gibt frei.",
                "A company whose software runs most of the work by itself. Daniel steers and approves.",
            ),
            Marke("repocity"),
        ),
        Szene(
            T("Erster Kontakt", "First contact"),
            T(
                "Ein Betrieb ruft an oder schreibt. Telefonassistentin und Mail-Eingang legen ihn "
                "als Kunden im CRM an.",
                "A business calls or writes. The phone assistant and incoming mail add it as a customer in the CRM.",
            ),
            Nabe(
                gleich("CRM"),
                (
                    T("Anruf", "Call"),
                    gleich("E-Mail"),
                    T("Kundenakte", "Customer file"),
                    T("Rückruf-Aufgabe", "Callback task"),
                ),
            ),
        ),
        Szene(
            T("Prüfung", "Audit"),
            T(
                "Daniel prüft die Webseite mit dem RadarAuditor: 108 Prüfungen in 14 Bereichen, "
                "von der Ladezeit bis zu Assistenten mit künstlicher Intelligenz.",
                "Daniel audits the website with the RadarAuditor: 108 checks in 14 areas, from "
                "load time to assistants built on artificial intelligence.",
            ),
            Handy(
                T("Prüfen", "Audit"),
                "dachdeckerei-muster.de",
                T("Prüfen", "Audit"),
                (
                    T("Wartet", "Waiting"),
                    T("Sammelt", "Collecting"),
                    T("Bewertet", "Scoring"),
                    T("Wertet aus", "Evaluating"),
                    T("Fertig", "Done"),
                ),
            ),
        ),
        Szene(
            T("Angebot", "Quote"),
            T(
                "Aus den offenen Punkten entsteht das Angebot. Das CRM verschickt es zusammen mit "
                "dem Prüfbericht als eine Datei.",
                "The open points become the quote. The CRM sends it together with the audit report as one file.",
            ),
            Blatt(
                T("Angebot mit Prüfbericht", "Quote with audit report"),
                (
                    (T("Positionen", "Items"), T("aus den offenen Punkten", "from the open points")),
                    (T("Preise", "Prices"), T("aus dem CRM", "from the CRM")),
                    (T("Versand", "Sending"), T("per Mail über das CRM", "by mail through the CRM")),
                ),
                T("Verschickt", "Sent"),
            ),
        ),
        Szene(
            T("Annahme", "Acceptance"),
            T(
                "Sagt der Kunde zu, ob in der App, per Mail oder am Telefon, legt das CRM Auftrag "
                "und Abo an. Auftragsbestätigung und Wartungsvertrag gehen ohne Freigabe hinaus.",
                "When the customer accepts, in the app, by mail or on the phone, the CRM creates "
                "order and subscription. Order confirmation and maintenance contract go out "
                "without approval.",
            ),
            Kette(
                (
                    T("Zusage", "Acceptance"),
                    T("Auftrag", "Order"),
                    T("Abo", "Subscription"),
                    T("Wartungsvertrag", "Maintenance contract"),
                )
            ),
        ),
        Szene(
            T("Optimierung", "Optimisation"),
            T(
                "Änderungen an Webseite und Google-Profil entstehen als Entwürfe. Daniel gibt "
                "jede frei, dann setzt der Server sie um.",
                "Changes to website and Google profile are prepared as drafts. Daniel approves "
                "each one, then the server applies it.",
            ),
            Kette(
                (
                    T("Entwurf", "Draft"),
                    T("Daniel gibt frei", "Daniel approves"),
                    T("Server setzt um", "Server applies"),
                    T("Optimierung fertig", "Optimisation finished"),
                )
            ),
        ),
        Szene(
            T("Rechnung", "Invoice"),
            T(
                "Ist nichts mehr offen, schließt das CRM den Auftrag, verschickt die Rechnung "
                "und bittet um eine Google-Bewertung.",
                "Once nothing is open, the CRM closes the order, sends the invoice and asks for a Google review.",
            ),
            Blatt(
                T("Rechnung", "Invoice"),
                (
                    (T("Auftrag", "Order"), T("erledigt", "done")),
                    (T("Rechnung", "Invoice"), T("festgeschrieben", "finalised")),
                    (T("Bewertung", "Review"), T("Bitte angelegt", "request created")),
                ),
                T("Verschickt", "Sent"),
            ),
        ),
        Szene(
            T("Jeden Monat", "Every month"),
            T(
                "Jeden Monat geht die Abo-Rechnung von selbst hinaus; passen im eingelesenen "
                "Kontoauszug Rechnungsnummer und Betrag, ist sie bezahlt. Die fällige "
                "Monatsprüfung startet Daniel mit einem Tipp im Cockpit.",
                "Every month the subscription invoice goes out by itself; when invoice number and "
                "amount match in the imported bank statement, it is paid. Daniel starts the due "
                "monthly audit with one tap in the Cockpit.",
            ),
            Mitteilungen(
                (
                    Karte(T("Mail verschickt: Rechnung", "Mail sent: invoice"), T("", "")),
                    Karte(
                        T("Monatsprüfung fällig", "Monthly audit due"),
                        T("", ""),
                        (T("Prüfung auslösen", "Start audit"),),
                    ),
                )
            ),
        ),
    ),
    quellen=(
        "README.de.md",
        "Dokumentation/INTEGRATION.de.md",
        "radarauditor/README.de.md",
        "radarauditor/Dokumentation/BETRIEBSANLEITUNG.de.md",
        "crm/README.de.md",
    ),
)

CRM = Teil(
    id="crm",
    name=gleich("CRM"),
    kurz=T("Kunden, Angebote, Rechnungen", "Customers, quotes, invoices"),
    satz=T(
        "Die Kundenverwaltung der Firma (CRM, Customer Relationship Management): Kunden mit "
        "vollständiger Akte, Angebote, Aufträge, Abos, Rechnungen, Mahnungen, Verträge, jede "
        "ausgehende Mail, Kalender und Finanzen vom Kontoauszug bis zum Gewinn je Monat.",
        "The company's CRM (customer relationship management): customers with their complete "
        "file, quotes, orders, subscriptions, invoices, reminders, contracts, every outgoing "
        "mail, calendar and finances from the bank statement to the profit per month.",
    ),
    stand=T(
        "App mit Anmeldung. Teststand ohne Kundenbetrieb.",
        "App behind a sign-in. Test stage without customer operation.",
    ),
    faehig=(
        T(
            "Heute: was ansteht, von Freigaben und fälligen Monatsprüfungen bis zu den Anrufen der letzten 24 Stunden.",
            "Today: what is due, from approvals and due monthly audits to the calls of the last 24 hours.",
        ),
        T(
            "Kundenakte mit Abos, Verträgen, Anrufen, jeder ausgehenden E-Mail, den Prüfungen "
            "aus dem RadarAuditor und allen Dokumenten.",
            "Customer file with subscriptions, contracts, calls, every outgoing e-mail, the "
            "RadarAuditor audits and all documents.",
        ),
        T(
            "„Angebot abschicken“ verschickt das Angebot selbst; die Seite zeigt, ob die Mail "
            "wartet, verschickt oder fehlgeschlagen ist.",
            "“Send quote” sends the quote itself; the page shows whether the mail is waiting, sent or failed.",
        ),
        T(
            "Rechnungen mit einer Nummernreihe, Zahlungen, Storno und elektronische Rechnung im Format XRechnung.",
            "Invoices with one number range, payments, cancellation and electronic invoices in the XRechnung format.",
        ),
        T(
            "Verträge aus Vorlagen und Bitten um eine Google-Bewertung mit einer Erinnerung; "
            "jeder Kunde kann jederzeit widersprechen.",
            "Contracts from templates and requests for a Google review with one reminder; every "
            "customer can object at any time.",
        ),
        T(
            "Kontoauszug einlesen (die Datei CAMT.053, die die Bank als elektronischen Auszug "
            "ausgibt): Passen Rechnungsnummer und offener Betrag, gilt die Rechnung als bezahlt; "
            "sonst fragt das Cockpit nach. Jede Buchung zählt einmal, auch beim zweiten Einlesen.",
            "Import the bank statement (the CAMT.053 file the bank issues as an electronic "
            "statement): when invoice number and open amount match, the invoice counts as paid; "
            "otherwise the Cockpit asks. Every booking counts once, even on a second import.",
        ),
        T(
            "Jede Abbuchung wird eine Ausgabe mit Belegen und einem Konto nach dem "
            "Standardkontenrahmen SKR03; das zuletzt gewählte Konto eines Empfängers gilt für "
            "seine nächsten Ausgaben, außer bei Zahlungsdiensten wie PayPal. Dazu der Gewinn je "
            "Monat über die letzten zwölf Monate.",
            "Every debit becomes an expense with receipts and an account from the standard chart "
            "of accounts SKR03; the account last chosen for a payee applies to their next "
            "expenses, except for payment services such as PayPal. Plus the profit per month "
            "over the last twelve months.",
        ),
        T(
            "Rückbuchungen erkennt das CRM im Auszug; nach „Verrechnen“ im Cockpit zählen beide "
            "Buchungen weder als Einnahme noch als Ausgabe, eine bezahlte Rechnung ist wieder offen.",
            "The CRM recognises returned payments in the statement; after “offset” in the "
            "Cockpit neither booking counts as income or expense, and a paid invoice is open again.",
        ),
        T(
            "Kalender mit Wochenansicht und Terminen; ein Rückrufwunsch am Telefon wird ein Termin, "
            "die Bestätigung an den Kunden trägt den Termin als Kalenderdatei, und das Handy "
            "abonniert den Kalender über einen geheimen Link, der nur liest.",
            "Calendar with a week view and appointments; a callback wish on the phone becomes an "
            "appointment, the confirmation to the customer carries it as a calendar file, and the "
            "phone subscribes to the calendar through a secret read-only link.",
        ),
        T(
            "Nachfass-Mails zu Angeboten ohne Antwort nach 5 und 12 Tagen, jede erst nach "
            "„Senden“ im Cockpit; über den Link in der Mail und einen Knopf bestellt der Kunde sie ab.",
            "Follow-up mails for unanswered quotes after 5 and 12 days, each only after “send” in "
            "the Cockpit; the link in the mail and one button unsubscribe the customer.",
        ),
        T(
            "Herkunft: Kanal und Kampagne bleiben am Kunden, jede Anfrage behält ihre eigenen; "
            "die Auswertung zählt je Kanal Anfragen, neue Kunden und Zahlungseingänge.",
            "Origin: channel and campaign stay with the customer, every enquiry keeps its own; "
            "the report counts enquiries, new customers and incoming payments per channel.",
        ),
        T(
            "Audit-Anfragen mit Gesprächsart vor Ort, Telefon oder Video und einer freien Stunde "
            "aus dem Kalender. Daniel bestätigt, schlägt drei andere Stunden vor oder startet die "
            "Prüfung; vorgeschlagene Stunden bleiben 48 Stunden für diesen Betrieb reserviert, am "
            "Vortag eines bestätigten Termins kommt eine Erinnerung.",
            "Audit requests with a meeting type of on site, phone or video and a free hour from "
            "the calendar. Daniel confirms, proposes three other hours or starts the audit; "
            "proposed hours stay reserved for that business for 48 hours, and a reminder goes "
            "out the day before a confirmed appointment.",
        ),
        T(
            "Paket für den Steuerberater: ein ZIP-Archiv je Monat, Quartal oder Jahr mit allen "
            "Rechnungen, Tabellen, dem DATEV-Buchungsstapel und den Ausgaben mit jedem Beleg.",
            "Tax adviser package: one ZIP archive per month, quarter or year with every invoice, "
            "tables, the DATEV booking batch and the expenses with every receipt.",
        ),
    ),
    verbindungen=(
        Verbindung(
            "radarauditor",
            T(
                "legt Angebote mit Positionen aus der Prüfung an und meldet „Optimierung fertig“; "
                "„Prüfen“ bei einer Audit-Anfrage startet dort die Prüfung der Webseite.",
                "creates quotes with items from the audit and reports “optimisation finished”; "
                "“audit” on an audit request starts the audit of the website there.",
            ),
        ),
        Verbindung(
            "cockpit",
            T(
                "bekommt jedes Ereignis als Mitteilung; Zahlungsvorschläge, Rückbuchungen, "
                "Nachfass-Mails, Audit-Anfragen und Mahnungen ohne aktuellen Kontoauszug warten "
                "dort auf einen Tipp.",
                "receives every event as a notification; payment proposals, returned payments, "
                "follow-up mails, audit requests and reminders without a current bank statement "
                "wait there for a tap.",
            ),
        ),
        Verbindung(
            "marketing",
            T(
                "Links der Marketing-App tragen Kanal und Kampagne, die das CRM dem Kunden zuordnet.",
                "links from the marketing app carry channel and campaign, which the CRM assigns to the customer.",
            ),
        ),
        Verbindung(
            "mail",
            T(
                "ordnet eingehende Mails zu und legt neue Kunden an.",
                "files incoming mail and adds new customers.",
            ),
        ),
        Verbindung(
            "telefon",
            T(
                "schreibt Anfragen, Rückruf-Aufgaben und Entscheidungen zu Angeboten ins CRM.",
                "writes enquiries, callback tasks and quote decisions into the CRM.",
            ),
        ),
    ),
    links=(github_ordner("crm"),),
    ablauf_titel=T(
        "Vom Angebot bis zum Paket für den Steuerberater",
        "From the quote to the tax adviser package",
    ),
    ablauf_satz=T(
        "Acht Stationen, die sich gegenseitig Arbeit übergeben. An jeder steht, wer sie auslöst und wo sie läuft.",
        "Eight stations that hand work to each other. Each one says who triggers it and where it runs.",
    ),
    stationen=(
        Station(
            T("Angebot anlegen", "Create the quote"),
            T(
                "Positionen aus den offenen Punkten der Prüfung, Produkte und Preise aus dem CRM.",
                "Items from the open points of the audit, products and prices from the CRM.",
            ),
            T("RadarAuditor-App oder CRM", "RadarAuditor app or CRM"),
            "daniel",
        ),
        Station(
            T("Angebot senden", "Send the quote"),
            T(
                "„Angebot abschicken“ stellt die Mail in den Postausgang. Der Postfach-Dienst "
                "hängt das Angebot mit dem Prüfbericht an und verschickt sie. Bleibt die Antwort "
                "aus, kommt nach 5 und nach 12 Tagen eine Nachfass-Mail zur Freigabe.",
                "“Send quote” puts the mail in the outbox. The mail service attaches the quote "
                "with the audit report and sends it. If no answer comes, a follow-up mail waits "
                "for approval after 5 and after 12 days.",
            ),
            T("CRM und Postfach-Dienst", "CRM and mail service"),
            "daniel",
        ),
        Station(
            T("Annahme", "Acceptance"),
            T(
                "Zusage aus der App, per Mail oder am Telefon: Auftrag, je monatlicher Position "
                "ein Abo zum angebotenen Preis. Auftragsbestätigung und Wartungsvertrag gehen "
                "ohne Freigabe hinaus.",
                "Acceptance from the app, by mail or on the phone: an order, and one subscription "
                "per monthly item at the quoted price. Order confirmation and maintenance "
                "contract go out without approval.",
            ),
            DATENBANK_CRM,
            "kunde",
        ),
        Station(
            T("Auftrag abschließen", "Complete the order"),
            T(
                "Nach „Optimierung fertig“ oder auf Daniels Tipp: Rechnung über die einmaligen "
                "Positionen festgeschrieben und verschickt, Bitte um eine Bewertung angelegt.",
                "After “optimisation finished” or on Daniel's tap: the invoice of the one-off "
                "items is finalised and sent, a review request is created.",
            ),
            DATENBANK_CRM,
            "selbst",
        ),
        Station(
            T("Tagesroutine", "Daily routine"),
            T(
                "Jeden Tag: Rechnungen fälliger Abos, fällige Monatsprüfungen und Bitten um eine "
                "Bewertung, mit einer Erinnerung nach der eingestellten Zahl von Tagen.",
                "Every day: invoices of due subscriptions, due monthly audits and review "
                "requests, with one reminder after the configured number of days.",
            ),
            ZEITPLAN,
            "selbst",
        ),
        Station(
            T("Kontoauszug", "Bank statement"),
            T(
                "Daniel liest den Auszug ein. Passen Rechnungsnummer und offener Betrag, ist die "
                "Rechnung bezahlt; sonst ein Vorschlag mit „Zuordnen“ im Cockpit. Jede Abbuchung "
                "wird eine Ausgabe, eine Rückbuchung wartet auf „Verrechnen“.",
                "Daniel imports the statement. When invoice number and open amount match, the "
                "invoice is paid; otherwise a proposal with “assign” in the Cockpit. Every debit "
                "becomes an expense, a returned payment waits for “offset”.",
            ),
            T("CRM, Seite Finanzen", "CRM, finances page"),
            "daniel",
        ),
        Station(
            T("Mahnung", "Reminder"),
            T(
                "Reichen die Kontoauszüge bis gestern, wartet kein Zahlungseingang auf eine "
                "Entscheidung und war die Rechnung mindestens zwei Tage vor dem letzten Auszugstag fällig, "
                "geht die Mahnung mit PDF von selbst hinaus. Sonst wartet sie im Cockpit auf „Senden“.",
                "When the bank statements reach yesterday, no incoming payment waits for a "
                "decision and the invoice was due at least two days before the last statement day, the "
                "reminder goes out by itself with its PDF. Otherwise it waits in the Cockpit for “Send”.",
            ),
            T("Zeitplan in der Datenbank und Cockpit", "Schedule in the database and Cockpit"),
            "selbst",
        ),
        Station(
            T("Paket für den Steuerberater", "Tax adviser package"),
            T(
                "Alle Rechnungsdokumente des Zeitraums, Rechnungen, Zahlungen und offene Posten "
                "als Tabellen und der DATEV-Buchungsstapel; dazu die Ausgaben mit eigenem "
                "Buchungsstapel und jedem Beleg.",
                "Every invoice document of the period, invoices, payments and open items as "
                "tables, and the DATEV booking batch; plus the expenses with their own booking "
                "batch and every receipt.",
            ),
            T("CRM, Seite Rechnungen", "CRM, invoices page"),
            "daniel",
        ),
    ),
    skills=(
        SkillGruppe(
            T("Oberfläche", "Interface"),
            (PREACT, gleich("Vite"), WEB_APP, T("Tests mit Vitest", "Tests with Vitest")),
        ),
        SkillGruppe(
            T("Datenbank", "Database"),
            (
                T("PostgreSQL in Supabase mit Migrationen", "PostgreSQL in Supabase with migrations"),
                ZEILENRECHTE,
                T(
                    "Geschäftslogik als Datenbankfunktionen und Auslöser",
                    "Business logic as database functions and triggers",
                ),
                T("Zeitpläne mit pg_cron", "Schedules with pg_cron"),
                T(
                    "Datenbanktests auf einem echten PostgreSQL",
                    "Database tests on a real PostgreSQL",
                ),
            ),
        ),
        SkillGruppe(
            T("Postfach-Dienst", "Mail service"),
            (
                DENO,
                T(
                    "Abruf per IMAP (Internet Message Access Protocol)",
                    "Fetching over IMAP (Internet Message Access Protocol)",
                ),
                T(
                    "Versand per SMTP (Simple Mail Transfer Protocol)",
                    "Sending over SMTP (Simple Mail Transfer Protocol)",
                ),
                T(
                    "Angebots-, Rechnungs- und Mahndokumente mit pdf-lib",
                    "Quote, invoice and reminder documents with pdf-lib",
                ),
            ),
        ),
        SkillGruppe(
            T("Buchhaltung", "Accounting"),
            (
                T(
                    "DATEV-Buchungsstapel im Format EXTF 700, Standardkontenrahmen SKR03",
                    "DATEV booking batch in the EXTF 700 format, standard chart of accounts SKR03",
                ),
                T("Elektronische Rechnung XRechnung", "XRechnung electronic invoice"),
                T("ZIP-Archiv mit fflate", "ZIP archive with fflate"),
                T(
                    "Kontoauszug im Format CAMT.053 (ISO 20022), in der Datenbank gelesen",
                    "Bank statement in the CAMT.053 format (ISO 20022), read in the database",
                ),
                T(
                    "Ausgaben mit Konten nach SKR03 und Belegen, die sich nicht löschen lassen",
                    "Expenses with SKR03 accounts and receipts that cannot be deleted",
                ),
            ),
        ),
        SkillGruppe(
            T("Kalender", "Calendar"),
            (
                T(
                    "Kalenderdateien nach iCalendar (RFC 5545)",
                    "Calendar files in the iCalendar format (RFC 5545)",
                ),
                T(
                    "Kalender-Abo fürs Handy als Edge Function hinter einem geheimen Link",
                    "Phone calendar subscription as an Edge Function behind a secret link",
                ),
                T(
                    "Abbestellen mit einem Klick im Mailprogramm (RFC 8058)",
                    "One-click unsubscribe in the mail program (RFC 8058)",
                ),
            ),
        ),
    ),
    film_titel=T("Das CRM in sieben Szenen", "The CRM in seven scenes"),
    szenen=(
        Szene(
            gleich("CRM"),
            T(
                "Die Kundenverwaltung der Firma: jeder Kunde mit seiner vollständigen Akte.",
                "The company's customer management: every customer with their complete file.",
            ),
            Marke("crm"),
        ),
        Szene(
            T("Kundenakte", "Customer file"),
            T(
                "In der Akte steht alles: Abos, Verträge, Anrufe, jede E-Mail und jede Prüfung.",
                "The file holds everything: subscriptions, contracts, calls, every e-mail and every audit.",
            ),
            Blatt(
                T("Kundenakte", "Customer file"),
                (
                    (T("Abos", "Subscriptions"), T("Preis laut Angebot", "price as quoted")),
                    (T("Verträge", "Contracts"), T("aus Vorlagen", "from templates")),
                    (T("Anrufe", "Calls"), T("mit Zusammenfassung", "with summary")),
                    (T("E-Mails", "E-mails"), T("jede mit ihrem Stand", "each with its status")),
                    (T("Prüfungen", "Audits"), T("aus dem RadarAuditor", "from the RadarAuditor")),
                ),
            ),
        ),
        Szene(
            T("Verkauf", "Sales"),
            T(
                "Vom Angebot über Auftrag und Rechnung bis zur Zahlung, mit einer Nummernreihe für alle Rechnungen.",
                "From quote to order, invoice and payment, with one number range for every invoice.",
            ),
            Kette(
                (
                    T("Angebot", "Quote"),
                    T("Auftrag", "Order"),
                    T("Rechnung", "Invoice"),
                    T("Zahlung", "Payment"),
                )
            ),
        ),
        Szene(
            T("Jeden Tag", "Every day"),
            T(
                "Jeden Tag läuft die Routine der Datenbank, nicht erst beim Öffnen der App.",
                "Every day the database runs its routine, not only when the app is opened.",
            ),
            Liste(
                (
                    T("Mahnungen", "Reminders"),
                    T("Abo-Rechnungen", "Subscription invoices"),
                    T("Fällige Monatsprüfungen", "Due monthly audits"),
                    T("Bitten um Bewertung", "Review requests"),
                    T("Nachfass-Mails", "Follow-up mails"),
                )
            ),
        ),
        Szene(
            T("Finanzen", "Finances"),
            T(
                "Der Kontoauszug verbucht Zahlungseingänge, jede Abbuchung wird eine Ausgabe mit "
                "Konto und Beleg, und der Gewinn steht je Monat.",
                "The bank statement books incoming payments, every debit becomes an expense with "
                "account and receipt, and the profit shows per month.",
            ),
            Blatt(
                T("Finanzen", "Finances"),
                (
                    (T("Kontoauszug", "Bank statement"), T("jede Buchung einmal", "every booking once")),
                    (T("Zahlungseingang", "Incoming payment"), T("zur Rechnung verbucht", "booked to the invoice")),
                    (T("Ausgaben", "Expenses"), T("Konto nach SKR03, Beleg", "SKR03 account, receipt")),
                    (T("Gewinn", "Profit"), T("je Monat", "per month")),
                ),
            ),
        ),
        Szene(
            T("Kalender", "Calendar"),
            T(
                "Termine im Kalender des CRM; vor Beginn meldet das Cockpit den Termin, und das "
                "Handy liest den Kalender über einen geheimen Link.",
                "Appointments in the CRM calendar; before the start the Cockpit announces the "
                "appointment, and the phone reads the calendar through a secret link.",
            ),
            Mitteilungen(
                (
                    Karte(T("Termin um 10:00: …", "Appointment at 10:00: …"), T("", "")),
                    Karte(T("Rückruf gewünscht: …", "Callback requested: …"), T("", "")),
                )
            ),
        ),
        Szene(
            T("Steuerberater", "Tax adviser"),
            T(
                "Je Monat, Quartal oder Jahr ein Paket für den Steuerberater, mit dem "
                "DATEV-Buchungsstapel und allen Belegen.",
                "One package for the tax adviser per month, quarter or year, with the DATEV "
                "booking batch and every receipt.",
            ),
            Blatt(
                T("Paket für den Steuerberater", "Tax adviser package"),
                (
                    (T("Rechnungen", "Invoices"), T("jedes Dokument", "every document")),
                    (
                        T("Tabellen", "Tables"),
                        T("Rechnungen, Zahlungen, offene Posten", "invoices, payments, open items"),
                    ),
                    (gleich("DATEV"), T("Buchungsstapel", "booking batch")),
                    (T("Ausgaben", "Expenses"), T("mit jedem Beleg", "with every receipt")),
                ),
                T("Fertig", "Ready"),
            ),
        ),
    ),
    quellen=(
        "crm/README.de.md",
        "Dokumentation/INTEGRATION.de.md",
        "crm/supabase/migrations/004_flow.sql",
        "crm/supabase/migrations/007_finanzen.sql",
        "crm/supabase/migrations/008_rueckbuchung_belege.sql",
        "crm/supabase/migrations/009_kalender.sql",
        "crm/supabase/migrations/010_nachfassen.sql",
        "crm/supabase/migrations/011_herkunft.sql",
        "crm/supabase/migrations/013_audit_anfragen.sql",
        "crm/app/package.json",
    ),
)

COCKPIT = Teil(
    id="cockpit",
    name=gleich("Cockpit"),
    kurz=T("Mitteilungen und Freigaben aufs Handy", "Notifications and approvals on the phone"),
    satz=T(
        "Die Nachrichtenzentrale über allen Apps der Firma: jedes Ereignis als Mitteilung aufs "
        "Handy, bis auf den Sperrbildschirm, mit Aktionen auf einen Tipp.",
        "The message centre above all of the company's apps: every event as a notification on "
        "the phone, right onto the lock screen, with one-tap actions.",
    ),
    stand=T(
        "App mit Anmeldung. Teststand ohne Kundenbetrieb.",
        "App behind a sign-in. Test stage without customer operation.",
    ),
    faehig=(
        T(
            "Mitteilungen zu jedem Ereignis aus CRM und Marketing, zu Monatsprüfungen und zu jedem Anruf.",
            "Notifications for every event from CRM and marketing, for monthly audits and for every call.",
        ),
        T(
            "Bis zu drei Knöpfe je Mitteilung, auch auf dem Sperrbildschirm: Mahnung senden, "
            "Prüfung auslösen, Annahme bestätigen, Zahlung zuordnen, Rückbuchung verrechnen, "
            "Audit-Anfrage bestätigen. Der Sperrbildschirm zeigt so viele, wie der Browser kann "
            "(Chrome und andere Browser auf Chromium-Grundlage zwei), die Nachrichtenzentrale alle.",
            "Up to three buttons per notification, on the lock screen too: send reminder, start "
            "audit, confirm acceptance, assign payment, offset a returned payment, confirm an "
            "audit request. The lock screen shows as many as the browser can (two in Chrome and "
            "other Chromium-based browsers), the message centre all of them.",
        ),
        T(
            "Assistent: Daniel tippt oder spricht eine Anfrage, und er erledigt genau vier Dinge: "
            "Kontakt anlegen, Termin eintragen, Mail entwerfen, Umsatz nennen. Eine entworfene "
            "Mail geht erst nach „Senden“ hinaus. Er arbeitet, sobald der Server der Firma läuft.",
            "Assistant: Daniel types or speaks a request, and it does exactly four things: add a "
            "contact, enter an appointment, draft a mail, state the revenue. A drafted mail only "
            "goes out after “send”. It works as soon as the company's server is running.",
        ),
        T(
            "Audit-Anfragen kommen mit „Bestätigen“, „Anderen Termin vorschlagen“ und „Prüfen“; "
            "bleibt eine 24 Stunden offen, meldet sie sich einmal neu.",
            "Audit requests arrive with “confirm”, “propose another time” and “audit”; if one "
            "stays open for 24 hours, it comes back once.",
        ),
        T(
            "Das Ergebnis ersetzt die Mitteilung unter derselben Kennung, statt eine zweite anzuhängen.",
            "The result replaces the notification under the same tag instead of adding a second one.",
        ),
        T(
            "Ein Knopf wirkt nur einmal und höchstens 14 Tage lang; die Berechtigungsnummer kommt "
            "nur mit der Mitteilung aufs Gerät.",
            "A button works once and for at most 14 days; the authorisation number only reaches "
            "the device with the notification.",
        ),
        T(
            "Jeden Morgen ein Überblick, von „Guten Morgen – alles ruhig“ bis zu den Punkten, die warten.",
            "Every morning an overview, from “all quiet” to the points that are waiting.",
        ),
        T(
            "Bleiben Mails eine Stunde ungelesen, kommt einmal am Tag die Frage, ob der Server läuft.",
            "If mail stays unread for an hour, the Cockpit asks once a day whether the server is running.",
        ),
    ),
    verbindungen=(
        Verbindung(
            "crm",
            T(
                "meldet Aufträge, Mails, Monatsprüfungen, Freigaben, Zahlungen, Termine und "
                "Audit-Anfragen; die Knöpfe und der Assistent rufen Funktionen des CRM auf.",
                "reports orders, mails, monthly audits, approvals, payments, appointments and "
                "audit requests; the buttons and the assistant call CRM functions.",
            ),
        ),
        Verbindung(
            "marketing",
            T(
                "meldet Beiträge zur Freigabe und erinnert, wann gepostet wird.",
                "reports posts awaiting approval and reminds when to post.",
            ),
        ),
        Verbindung(
            "radarauditor",
            T(
                "ein Tipp auf „Prüfung auslösen“ legt die Monatsprüfung in die Warteschlange, "
                "„Prüfen“ bei einer Audit-Anfrage die Prüfung ihrer Webseite; der Server des "
                "RadarAuditors beantwortet den Assistenten.",
                "one tap on “start audit” puts the monthly audit in the queue, “audit” on an audit "
                "request the audit of its website; the RadarAuditor's server answers the assistant.",
            ),
        ),
        Verbindung(
            "telefon",
            T(
                "jedes Gespräch erscheint als „Anruf von …“; die Spracherkennung macht auch aus "
                "gesprochenen Anfragen an den Assistenten Text.",
                "every call appears as “call from …”; the speech recognition also turns spoken "
                "requests to the assistant into text.",
            ),
        ),
        Verbindung(
            "mail",
            T(
                "unsichere Fälle kommen mit dem Knopf „Annahme bestätigen“.",
                "unsure cases arrive with the button “confirm acceptance”.",
            ),
        ),
    ),
    links=(github_ordner("cockpit"),),
    ablauf_titel=T(
        "Vom Ereignis bis zum Tipp auf dem Sperrbildschirm",
        "From the event to the tap on the lock screen",
    ),
    ablauf_satz=T(
        "Sechs Stationen; an jeder steht, wer sie auslöst und wo sie läuft.",
        "Six stations; each one says who triggers it and where it runs.",
    ),
    stationen=(
        Station(
            T("Ereignis", "Event"),
            T(
                "Eine App meldet etwas an die Nachrichtenzentrale. Dieselbe Meldung zählt nur "
                "einmal, damit wiederkehrende Prüfungen das Handy nicht fluten.",
                "An app reports something to the message centre. The same report counts once, "
                "so recurring checks do not flood the phone.",
            ),
            T("Datenbank, Schema cockpit", "Database, schema cockpit"),
            "selbst",
        ),
        Station(
            gleich("Push"),
            T(
                "Die Mitteilung geht verschlüsselt an jedes angemeldete Gerät, ohne das "
                "auslösende Ereignis aufzuhalten.",
                "The notification goes encrypted to every registered device without holding up "
                "the event that caused it.",
            ),
            T("Edge Function cockpit-push", "Edge Function cockpit-push"),
            "selbst",
        ),
        Station(
            T("Mitteilung mit Knöpfen", "Notification with buttons"),
            T(
                "Bis zu drei Knöpfe, zum Beispiel „Senden“ und „Nicht senden“ bei einer Mahnung; "
                "eine Mitteilung mit Knöpfen öffnet beim Tippen die Nachrichtenzentrale.",
                "Up to three buttons, for example “send” and “do not send” for a reminder; a "
                "notification with buttons opens the message centre when tapped.",
            ),
            T("Handy, auch Sperrbildschirm", "Phone, lock screen too"),
            "daniel",
        ),
        Station(
            T("Aktion", "Action"),
            T(
                "Geprüft wird: Knopf angeboten, noch nicht benutzt, Mitteilung höchstens 14 Tage "
                "alt. Dann läuft die Aktion im CRM, und ein Antwortsatz ersetzt die Mitteilung.",
                "Checked first: button offered, not yet used, notification at most 14 days old. "
                "Then the action runs in the CRM and a reply sentence replaces the notification.",
            ),
            T("Datenbank, cockpit.run_action", "Database, cockpit.run_action"),
            "selbst",
        ),
        Station(
            T("Morgenüberblick und Wächter", "Morning overview and watchdog"),
            T(
                "Jeden Morgen ein Überblick; stündlich der Blick, ob die Mails gelesen werden.",
                "An overview every morning; every hour a look at whether mail is being read.",
            ),
            ZEITPLAN,
            "selbst",
        ),
        Station(
            T("Assistent", "Assistant"),
            T(
                "Daniel tippt oder spricht. Der Server macht aus der Sprache Text und löscht die "
                "Aufnahme, ein Sprachmodell liest die Anfrage als eine von vier Aufgaben, die "
                "Datenbank führt sie aus und meldet zurück, was sie gespeichert hat.",
                "Daniel types or speaks. The server turns the speech into text and deletes the "
                "recording, a language model reads the request as one of four tasks, the database "
                "carries it out and reports back what it stored.",
            ),
            T("Cockpit, Server und Datenbank des CRM", "Cockpit, server and CRM database"),
            "daniel",
        ),
    ),
    skills=(
        SkillGruppe(
            T("Oberfläche", "Interface"),
            (
                PREACT,
                gleich("Vite"),
                WEB_APP,
                T("Eigener Service Worker", "Own service worker"),
            ),
        ),
        SkillGruppe(
            T("Push-Nachrichten", "Push messages"),
            (
                T(
                    "Verschlüsselung nach RFC 8291 (Request for Comments, ein Internet-Standard)",
                    "Encryption by RFC 8291 (Request for Comments, an internet standard)",
                ),
                T(
                    "Absenderkennung nach RFC 8292 (Voluntary Application Server Identification)",
                    "Sender identification by RFC 8292 (Voluntary Application Server Identification)",
                ),
                DENO,
            ),
        ),
        SkillGruppe(
            T("Datenbank", "Database"),
            (
                T("Auslöser in den Tabellen des CRM", "Triggers on the CRM tables"),
                T("Asynchroner Versand mit pg_net", "Asynchronous sending with pg_net"),
                T("Zeitpläne mit pg_cron", "Schedules with pg_cron"),
                T("Live-Aktualisierung der offenen App", "Live updates for the open app"),
                ZEILENRECHTE,
            ),
        ),
        SkillGruppe(
            T("Assistent", "Assistant"),
            (
                T(
                    "Aufnahme im Browser mit einem AudioWorklet (Tonbaustein des Browsers), höchstens 60 Sekunden",
                    "Recording in the browser with an AudioWorklet (the browser's audio building "
                    "block), at most 60 seconds",
                ),
                T(
                    "Umrechnung auf 16 Kilohertz und eine WAV-Datei mit 16 Bit",
                    "Conversion to 16 kilohertz and a 16-bit WAV file",
                ),
                T(
                    "Bildschirm bleibt während der Aufnahme an (Wake Lock)",
                    "Screen stays on during the recording (Wake Lock)",
                ),
                T(
                    "Antwort des Sprachmodells zweimal gegen ein festes Format geprüft",
                    "The language model's answer checked twice against a fixed format",
                ),
            ),
        ),
    ),
    film_titel=T("Das Cockpit in sieben Szenen", "The Cockpit in seven scenes"),
    szenen=(
        Szene(
            gleich("Cockpit"),
            T(
                "Die Nachrichtenzentrale über allen Apps der Firma.",
                "The message centre above all of the company's apps.",
            ),
            Marke("cockpit"),
        ),
        Szene(
            T("Ereignisse", "Events"),
            T(
                "Jedes Ereignis aus den Apps kommt als Mitteilung aufs Handy, bis auf den Sperrbildschirm.",
                "Every event from the apps arrives as a notification on the phone, right onto the lock screen.",
            ),
            Mitteilungen(
                (
                    Karte(T("Neuer Auftrag: …", "New order: …"), T("", "")),
                    Karte(T("Beitrag zur Freigabe: …", "Post for approval: …"), T("", "")),
                    Karte(T("Anruf von …", "Call from …"), T("", "")),
                )
            ),
        ),
        Szene(
            T("Ein Tipp", "One tap"),
            T(
                "Bis zu drei Knöpfe je Mitteilung. Ein Tipp verschickt zum Beispiel eine Mahnung.",
                "Up to three buttons per notification. One tap sends a reminder, for example.",
            ),
            Mitteilungen(
                (
                    Karte(
                        T("Freigabe nötig", "Approval needed"),
                        T("Mahnung", "Reminder"),
                        (T("Senden", "Send"), T("Nicht senden", "Do not send")),
                    ),
                )
            ),
        ),
        Szene(
            T("Ersetzen", "Replace"),
            T(
                "Das Ergebnis ersetzt die Mitteilung unter derselben Kennung, statt eine zweite anzuhängen.",
                "The result replaces the notification under the same tag instead of adding a second one.",
            ),
            Mitteilungen(
                (
                    Karte(T("Mail erstellt: …", "Mail created: …"), T("", "")),
                    Karte(T("Mail verschickt: …", "Mail sent: …"), T("", "")),
                ),
                ersetzen=True,
            ),
        ),
        Szene(
            T("Audit-Anfrage", "Audit request"),
            T(
                "Eine Audit-Anfrage kommt mit drei Knöpfen: bestätigen, eine andere Zeit vorschlagen "
                "oder gleich die Webseite prüfen.",
                "An audit request arrives with three buttons: confirm, propose another time or "
                "audit the website right away.",
            ),
            Mitteilungen(
                (
                    Karte(
                        T("Audit-Anfrage: …", "Audit request: …"),
                        T("Wunsch … · Ansprechpartner · Gesprächsart", "Wish … · contact · meeting type"),
                        (
                            T("Bestätigen", "Confirm"),
                            T("Anderen Termin vorschlagen", "Propose another time"),
                            T("Prüfen", "Audit"),
                        ),
                    ),
                )
            ),
        ),
        Szene(
            T("Assistent", "Assistant"),
            T(
                "Daniel spricht eine Anfrage ins Cockpit. Der Assistent erledigt sie und meldet, "
                "was er gespeichert hat.",
                "Daniel speaks a request into the Cockpit. The assistant carries it out and reports what it stored.",
            ),
            Kette(
                (
                    T("Sprechen", "Speak"),
                    T("Text", "Text"),
                    T("Eine von vier Aufgaben", "One of four tasks"),
                    T("Assistent: erledigt", "Assistant: done"),
                )
            ),
        ),
        Szene(
            T("Morgens", "Mornings"),
            T(
                "Jeden Morgen ein Überblick. Bleiben Mails eine Stunde ungelesen, fragt das "
                "Cockpit, ob der Server läuft.",
                "An overview every morning. If mail stays unread for an hour, the Cockpit asks "
                "whether the server is running.",
            ),
            Mitteilungen(
                (
                    Karte(
                        T("Guten Morgen – alles ruhig", "Good morning – all quiet"),
                        T(
                            "Offene Forderungen · Eingang im Monat",
                            "Open receivables · received this month",
                        ),
                    ),
                    Karte(
                        T(
                            "Mails werden nicht gelesen – läuft der Server?",
                            "Mail is not being read – is the server running?",
                        ),
                        T("", ""),
                    ),
                )
            ),
        ),
    ),
    quellen=(
        "cockpit/README.de.md",
        "cockpit/supabase/migrations/001_cockpit.sql",
        "cockpit/supabase/migrations/002_actions.sql",
        "cockpit/supabase/migrations/006_kalender_nachfassen.sql",
        "cockpit/supabase/migrations/007_audit_anfragen.sql",
        "Dokumentation/INTEGRATION.de.md",
    ),
)

RADARAUDITOR = Teil(
    id="radarauditor",
    name=gleich("RadarAuditor"),
    kurz=T("Prüft, wie sichtbar ein Betrieb ist", "Audits how visible a business is"),
    satz=T(
        "Das Produkt der Firma: misst, wie sichtbar ein örtlicher Betrieb bei Google, auf Google "
        "Maps, in Verzeichnissen und in Assistenten mit künstlicher Intelligenz ist, und macht "
        "daraus Verkaufsbericht, Angebot und jeden Monat einen Vorher-nachher-Bericht.",
        "The company's product: measures how visible a local business is on Google, Google "
        "Maps, in directories and in assistants built on artificial intelligence, and turns that "
        "into a sales report, a quote and a monthly before-and-after report.",
    ),
    stand=T(
        "App veröffentlicht; Sammler und Auswertung sind gebaut für den eigenen Server der "
        "Firma. Teststand ohne Kundenbetrieb.",
        "App published; collector and evaluation are built for the company's own server. Test "
        "stage without customer operation.",
    ),
    faehig=(
        T(
            "Nur die Webseiten-Adresse eingeben: Betrieb, Ort, Branche und Suchbegriffe ermittelt der Server selbst.",
            "Enter only the website address: the server works out business, town, trade and search terms itself.",
        ),
        T(
            "108 Prüfungen in 14 Bereichen, bewertet gegen einen festen Prüfkatalog.",
            "108 checks in 14 areas, scored against a fixed check catalogue.",
        ),
        T(
            "Auswertung mit dem Gesprächstext „Das sagen Sie dem Kunden“ und den drei größten Hebeln.",
            "Evaluation with the talk text “what you tell the customer” and the three biggest levers.",
        ),
        T(
            "Jede Prüfung zum Aufklappen: warum sie zählt, was gemessen wurde, die Lösung.",
            "Every check expands: why it matters, what was measured, the fix.",
        ),
        T(
            "Angebot vor Ort: Positionen aus den offenen Punkten, Preise aus dem CRM.",
            "Quote on site: items from the open points, prices from the CRM.",
        ),
        T(
            "Optimierung von Webseite und Google-Profil: Änderungen als Entwürfe, jede gibt Daniel frei.",
            "Optimisation of website and Google profile: changes as drafts, each approved by Daniel.",
        ),
        T(
            "Monatsprüfung mit Vorher-nachher-Bericht.",
            "Monthly audit with a before-and-after report.",
        ),
        T(
            "Offene Audit-Anfragen aus dem CRM stehen in der App unter dem Knopf „Prüfen“; eine "
            "Anfrage mit Webseite füllt das Adressfeld, geprüft wird erst nach dem Tipp auf „Prüfen“.",
            "Open audit requests from the CRM are listed in the app below the “audit” button; a "
            "request with a website fills in the address field, and the audit only starts after "
            "the tap on “audit”.",
        ),
        T(
            "Der Server beantwortet auch die Anfragen an den Assistenten im Cockpit.",
            "The server also answers the requests to the assistant in the Cockpit.",
        ),
    ),
    verbindungen=(
        Verbindung(
            "crm",
            T(
                "übernimmt Angebot, Auftrag, Rechnung und die Termine der Monatsprüfung.",
                "takes over quote, order, invoice and the monthly audit dates.",
            ),
        ),
        Verbindung(
            "cockpit",
            T(
                "startet die fällige Monatsprüfung mit einem Tipp, „Prüfen“ bei einer "
                "Audit-Anfrage die Prüfung ihrer Webseite.",
                "starts the due monthly audit with one tap, “audit” on an audit request the audit of its website.",
            ),
        ),
        Verbindung(
            "mail",
            T(
                "im Container des RadarAuditors auf dem Server werden auch die Mails gelesen.",
                "the RadarAuditor's container on the server also reads the mail.",
            ),
        ),
        Verbindung(
            "webseiten",
            T(
                "misst, was einer Webseite fehlt.",
                "measures what a website is missing.",
            ),
        ),
    ),
    links=(
        Link(
            T("Projektseite RadarAuditor", "RadarAuditor project page"),
            T(
                "https://radarauditor.speedofthespirit.dev/#praesentation",
                "https://radarauditor.speedofthespirit.dev/en/#praesentation",
            ),
        ),
        github_ordner("radarauditor"),
    ),
    ablauf_titel=T(
        "Von der Webseiten-Adresse bis zur Monatsprüfung",
        "From the website address to the monthly audit",
    ),
    ablauf_satz=T(
        "Acht Stationen; an jeder steht, wer sie auslöst und wo sie läuft.",
        "Eight stations; each one says who triggers it and where it runs.",
    ),
    stationen=(
        Station(
            T("Prüfung starten", "Start the audit"),
            T(
                "Daniel gibt nur die Webseiten-Adresse ein und wählt die Prüfungen, oder er tippt "
                "„Prüfen“ bei einer Audit-Anfrage im Cockpit.",
                "Daniel enters only the website address and picks the checks, or he taps “audit” "
                "on an audit request in the Cockpit.",
            ),
            T("App auf Handy, Tablet und PC oder Cockpit", "App on phone, tablet and computer, or Cockpit"),
            "daniel",
        ),
        Station(
            T("Sammeln", "Collect"),
            T(
                "Der Sammler erkennt Betrieb, Ort und Branche und holt die Daten.",
                "The collector recognises business, town and trade and fetches the data.",
            ),
            EIGENER_SERVER,
            "selbst",
        ),
        Station(
            T("Bewerten", "Score"),
            T(
                "108 Prüfungen in 14 Bereichen, bewertet gegen den festen Prüfkatalog.",
                "108 checks in 14 areas, scored against the fixed catalogue.",
            ),
            EIGENER_SERVER,
            "selbst",
        ),
        Station(
            T("Auswerten", "Evaluate"),
            T(
                "Ein Sprachmodell macht aus den Rohdaten Befunde, Lösungen und Berichtstexte; "
                "die Ausgabe wird gegen ein festes Datenformat geprüft.",
                "A language model turns the raw data into findings, fixes and report texts; the "
                "output is checked against a fixed data format.",
            ),
            EIGENER_SERVER,
            "selbst",
        ),
        Station(
            T("Angebot und Annahme", "Quote and acceptance"),
            T(
                "Angebot erstellen, „Angebot abschicken“, dann die Entscheidung des Kunden: "
                "„Angenommen“ legt im CRM den Auftrag an.",
                "Create the quote, “send quote”, then the customer's decision: “accepted” "
                "creates the order in the CRM.",
            ),
            T("App und Datenbank des CRM", "App and CRM database"),
            "daniel",
        ),
        Station(
            T("Optimierung", "Optimisation"),
            T(
                "Änderungen an Webseite und Google-Profil entstehen als Entwürfe. Daniel sieht "
                "jede vorher und nachher und gibt sie frei oder lehnt sie ab.",
                "Changes to website and Google profile are prepared as drafts. Daniel sees each "
                "one before and after and approves or rejects it.",
            ),
            T("App und Server", "App and server"),
            "daniel",
        ),
        Station(
            T("Optimierung fertig", "Optimisation finished"),
            T(
                "Ist keine Änderung mehr offen, schreibt die Datenbank das Ereignis, und das CRM schließt den Auftrag.",
                "When no change is left open, the database writes the event and the CRM closes the order.",
            ),
            T("Datenbank", "Database"),
            "selbst",
        ),
        Station(
            T("Monatsprüfung", "Monthly audit"),
            T(
                "Ist ein Abo fällig, startet ein Tipp im Cockpit die Prüfung erneut; der Bericht "
                "zeigt vorher und nachher.",
                "When a subscription is due, one tap in the Cockpit runs the audit again; the "
                "report shows before and after.",
            ),
            T("Cockpit und Server", "Cockpit and server"),
            "daniel",
        ),
    ),
    skills=(
        SkillGruppe(
            T("Sammler", "Collector"),
            (
                gleich("Python"),
                T("Browser-Automatisierung mit Playwright", "Browser automation with Playwright"),
                T("httpx und BeautifulSoup", "httpx and BeautifulSoup"),
                gleich("Docker"),
            ),
        ),
        SkillGruppe(
            T("Bewertung", "Scoring"),
            (
                T("Prüfkatalog als YAML-Datei", "Check catalogue as a YAML file"),
                T("Datenmodelle mit Pydantic", "Data models with Pydantic"),
                T("Tests mit pytest", "Tests with pytest"),
            ),
        ),
        SkillGruppe(
            T("Auswertung", "Evaluation"),
            (
                T(
                    "Sprachmodell ohne Bildschirm mit eigenen Skills für Auswertung und Optimierung",
                    "Language model without a screen, with its own skills for evaluation and optimisation",
                ),
                T(
                    "Ausgabe gegen ein festes Datenformat geprüft",
                    "Output checked against a fixed data format",
                ),
            ),
        ),
        SkillGruppe(
            T("Berichte", "Reports"),
            (
                T("Druckfertige Berichte mit WeasyPrint", "Print-ready reports with WeasyPrint"),
                T("Vorlagen mit Jinja2", "Templates with Jinja2"),
                T("Diagramme mit Matplotlib", "Charts with Matplotlib"),
            ),
        ),
        SkillGruppe(
            gleich("App"),
            (
                PREACT,
                WEB_APP,
                T("Diagramme mit Chart.js", "Charts with Chart.js"),
                T("Radar mit three.js", "Radar with three.js"),
            ),
        ),
        SkillGruppe(
            T("Daten", "Data"),
            (
                T("Supabase und PostgreSQL", "Supabase and PostgreSQL"),
                ZEILENRECHTE,
                T("Auftragswarteschlange in der Datenbank", "Job queue in the database"),
            ),
        ),
    ),
    film_titel=T("Der RadarAuditor in fünf Szenen", "The RadarAuditor in five scenes"),
    szenen=(
        Szene(
            gleich("RadarAuditor"),
            T(
                "Misst, wie sichtbar ein örtlicher Betrieb bei Google, in Verzeichnissen und in "
                "Assistenten mit künstlicher Intelligenz ist.",
                "Measures how visible a local business is on Google, in directories and in "
                "assistants built on artificial intelligence.",
            ),
            Marke("radarauditor"),
        ),
        Szene(
            T("Eingabe", "Input"),
            T(
                "Eine Webseiten-Adresse genügt. Betrieb, Ort und Branche ermittelt der Server selbst.",
                "A website address is enough. The server works out business, town and trade itself.",
            ),
            Handy(
                T("Prüfen", "Audit"),
                "dachdeckerei-muster.de",
                T("Prüfen", "Audit"),
                (
                    T("Wartet", "Waiting"),
                    T("Sammelt", "Collecting"),
                    T("Bewertet", "Scoring"),
                    T("Wertet aus", "Evaluating"),
                    T("Fertig", "Done"),
                ),
            ),
        ),
        Szene(
            T("Prüfkatalog", "Catalogue"),
            T(
                "108 Prüfungen in 14 Bereichen aus einem einzigen Prüfkatalog.",
                "108 checks in 14 areas from one single catalogue.",
            ),
            Liste(BEREICHE),
        ),
        Szene(
            T("Auswertung", "Evaluation"),
            T(
                "Die Auswertung liefert den Gesprächstext für den Kunden und die drei größten Hebel.",
                "The evaluation delivers the talk text for the customer and the three biggest levers.",
            ),
            Blatt(
                T("Auswertung", "Evaluation"),
                (
                    (T("Erkannt", "Recognised"), T("Betrieb, Ort, Branche", "business, town, trade")),
                    (T("Das sagen Sie dem Kunden", "What you tell the customer"), T("Gesprächstext", "talk text")),
                    (T("Die größten Hebel", "The biggest levers"), T("drei Prüfungen", "three checks")),
                ),
            ),
        ),
        Szene(
            T("Übergabe", "Handover"),
            T(
                "Nach der Annahme übernimmt das CRM: Auftrag, Rechnung und jeden Monat eine neue Prüfung.",
                "After acceptance the CRM takes over: order, invoice and a new audit every month.",
            ),
            Kette(
                (
                    T("Angebot", "Quote"),
                    T("Annahme", "Acceptance"),
                    T("Optimierung", "Optimisation"),
                    T("Monatsprüfung", "Monthly audit"),
                )
            ),
        ),
    ),
    quellen=(
        "radarauditor/README.de.md",
        "radarauditor/config/pruefkatalog.yaml",
        "radarauditor/Dokumentation/BETRIEBSANLEITUNG.de.md",
        "Dokumentation/INTEGRATION.de.md",
        "radarauditor/pyproject.toml",
        "radarauditor/app/package.json",
        "radarauditor/app/src/components/OpenRequests.tsx",
    ),
)

KANAELE = (
    gleich("Blog"),
    gleich("LinkedIn"),
    gleich("X"),
    gleich("XING"),
    gleich("Instagram"),
    gleich("Facebook"),
    gleich("Threads"),
    gleich("YouTube"),
    gleich("TikTok"),
    gleich("Reddit"),
    gleich("Forum"),
    T("Presse", "Press"),
    gleich("Newsletter"),
)

MARKETING = Teil(
    id="marketing",
    name=gleich("Marketing"),
    kurz=T("Geprüfte Recherche, Kampagnen, Planer", "Checked research, campaigns, planner"),
    satz=T(
        "Recherche, bei der jede Zahl gegen ihre Quelle geprüft ist. Kampagnen und Beiträge "
        "gehen zur Freigabe in den Planer und werden von Hand über die Firmenkonten gepostet.",
        "Research with every figure checked against its source. Campaigns and posts go to the "
        "planner for approval and are posted by hand from the company accounts.",
    ),
    stand=T(
        "Planer als App mit Anmeldung; das Recherche-Werkzeug läuft auf dem PC des Betreibers. "
        "Teststand ohne Kundenbetrieb.",
        "Planner as an app behind a sign-in; the research tool runs on the operator's computer. "
        "Test stage without customer operation.",
    ),
    faehig=(
        T(
            "Jede Zahl eines Befunds wird im Text seiner Quelle gesucht, bevor ein Mensch ihn "
            "liest; das braucht kein Sprachmodell und kostet nichts.",
            "Every figure of a finding is looked up in the text of its source before a person "
            "reads it; this needs no language model and costs nothing.",
        ),
        T(
            "Ein Mensch behält oder verwirft jeden Befund; jede Entscheidung liegt als Datei vor.",
            "A person keeps or drops every finding; every decision is stored as a file.",
        ),
        T(
            "Kampagnen aus geprüften Befunden: Jede Zahl eines Beitrags wird gegen die Befunde "
            "abgeglichen, die er nennt.",
            "Campaigns from checked findings: every figure of a post is matched against the findings it cites.",
        ),
        T(
            "Planer für 13 Kanäle in einem Kalender, von Blog und LinkedIn bis Newsletter.",
            "Planner for 13 channels in one calendar, from blog and LinkedIn to newsletter.",
        ),
        T(
            "Ein Beitrag mit Zahlen ohne geprüfte Quelle lässt sich nicht freigeben.",
            "A post with figures that lack a checked source cannot be approved.",
        ),
        T(
            "Meldet, welche Punkte veraltet sind; löscht und überschreibt dabei nichts.",
            "Reports which points have gone stale; deletes and overwrites nothing.",
        ),
        T(
            "Beim Kopieren eines Beitrags bekommt jeder Link auf eine eigene Seite Kanal, "
            "Kampagne und Beitrag als Herkunfts-Merker (die Adresszusätze utm_source, "
            "utm_medium, utm_campaign und utm_content), außer im Blog, der selbst eine eigene "
            "Seite ist; daran erkennt das CRM, woher eine Anfrage kommt.",
            "When a post is copied, every link to an own site gets channel, campaign and post as "
            "origin markers (the address parameters utm_source, utm_medium, utm_campaign and "
            "utm_content), except in the blog, which is an own site itself; from them the CRM "
            "tells where an enquiry comes from.",
        ),
    ),
    verbindungen=(
        Verbindung(
            "cockpit",
            T(
                "„Beitrag zur Freigabe“ und stündlich „Jetzt posten“ kommen als Mitteilung.",
                "“post for approval” and, every hour, “post now” arrive as notifications.",
            ),
        ),
        Verbindung(
            "crm",
            T(
                "ordnet Anfragen über die Herkunfts-Merker der Links dem Kanal und der Kampagne zu.",
                "assigns enquiries to channel and campaign through the origin markers of the links.",
            ),
        ),
        Verbindung(
            "radarauditor",
            T(
                "die erste Kampagne handelt vom RadarAuditor und wartet als Entwurf auf die neuen Firmenkonten.",
                "the first campaign is about the RadarAuditor and waits as a draft for the new company accounts.",
            ),
        ),
    ),
    links=(
        Link(
            T("Projektseite Agentic Marketing", "Agentic Marketing project page"),
            T(
                "https://agenticmarketing.speedofthespirit.dev/#praesentation",
                "https://agenticmarketing.speedofthespirit.dev/?lang=en#praesentation",
            ),
        ),
        github_ordner("marketing"),
    ),
    ablauf_titel=T("Von der Recherche bis zum Beitrag", "From research to the post"),
    ablauf_satz=T(
        "Sieben Stationen; an jeder steht, wer sie auslöst und wo sie läuft.",
        "Seven stations; each one says who triggers it and where it runs.",
    ),
    stationen=(
        Station(
            T("Recherche", "Research"),
            T(
                "Eine Recherche-Sitzung schreibt jeden Befund als eigene Datei, mit Aussage und "
                "Quelle; eine Aussage ohne Quelle gilt als Fehler.",
                "A research session writes each finding as its own file, with statement and "
                "source; a statement without a source counts as an error.",
            ),
            T("PC des Betreibers", "Operator's computer"),
            "selbst",
        ),
        Station(
            T("Zahlen prüfen", "Check the figures"),
            T(
                "Jede Zahl wird im Text der Quelle gesucht, ob Webseite, PDF-Datei (Portable "
                "Document Format) oder Datei im Arbeitsbereich.",
                "Every figure is looked up in the text of the source, whether web page, PDF "
                "(Portable Document Format) or file in the workspace.",
            ),
            T("PC des Betreibers", "Operator's computer"),
            "selbst",
        ),
        Station(
            T("Durchsicht", "Review"),
            T(
                "Ein Mensch sieht jeden Befund mit seinem Prüfergebnis und behält oder verwirft ihn.",
                "A person sees every finding with its check result and keeps or drops it.",
            ),
            T("Seite zur Durchsicht", "Review page"),
            "daniel",
        ),
        Station(
            T("Kampagne", "Campaign"),
            T(
                "Beiträge aus den behaltenen Befunden; jede Zahl eines Beitrags muss in einem "
                "genannten Befund stehen, dann geht die Kampagne an den Planer.",
                "Posts from the kept findings; every figure of a post has to appear in a cited "
                "finding, then the campaign goes to the planner.",
            ),
            T("PC des Betreibers und Datenbank", "Operator's computer and database"),
            "selbst",
        ),
        Station(
            T("Freigabe im Planer", "Approval in the planner"),
            T(
                "Im Kalender bekommt jeder Beitrag seinen Termin; freigeben lässt sich nur ein "
                "Beitrag, dessen Zahlen belegt sind.",
                "In the calendar every post gets its date; only a post whose figures are backed can be approved.",
            ),
            T("Marketing-App", "Marketing app"),
            "daniel",
        ),
        Station(
            T("Posten", "Post"),
            T(
                "Ist der Termin da, meldet das Cockpit „Jetzt posten“; gepostet wird von Hand über "
                "die Firmenkonten. Der kopierte Text trägt die Herkunfts-Merker in seinen Links.",
                "When the date has come, the Cockpit says “post now”; posting is done by hand "
                "from the company accounts. The copied text carries the origin markers in its links.",
            ),
            T("Cockpit und Firmenkonten", "Cockpit and company accounts"),
            "daniel",
        ),
        Station(
            T("Frische", "Freshness"),
            T(
                "Meldet Punkte, deren Quelle zu alt ist oder deren Adresse nicht mehr erreichbar ist.",
                "Reports points whose source is too old or whose address no longer answers.",
            ),
            T("PC des Betreibers", "Operator's computer"),
            "selbst",
        ),
    ),
    skills=(
        SkillGruppe(
            T("Recherche-Werkzeug", "Research tool"),
            (
                gleich("Python"),
                T(
                    "Kommandozeile mit verify, review, apply, pack, stale und campaign",
                    "Command line with verify, review, apply, pack, stale and campaign",
                ),
                T("Datenmodelle mit Pydantic", "Data models with Pydantic"),
                T("Quellen lesen mit httpx und pypdf", "Reading sources with httpx and pypdf"),
                T("Wiederholversuche mit tenacity", "Retries with tenacity"),
            ),
        ),
        SkillGruppe(
            T("Planer", "Planner"),
            (
                PREACT,
                T("Diagramme mit Chart.js", "Charts with Chart.js"),
                T("Texte mit markdown-it", "Texts with markdown-it"),
                T("Tests mit Vitest", "Tests with Vitest"),
            ),
        ),
        SkillGruppe(
            T("Datenbank", "Database"),
            (
                T("Schema marketing in Supabase", "Schema marketing in Supabase"),
                T(
                    "Sperre der Freigabe als Datenbank-Auslöser",
                    "Approval lock as a database trigger",
                ),
                T("Erinnerungen mit pg_cron", "Reminders with pg_cron"),
            ),
        ),
    ),
    film_titel=T("Das Marketing in fünf Szenen", "Marketing in five scenes"),
    szenen=(
        Szene(
            gleich("Marketing"),
            T(
                "Recherche, bei der jede Zahl gegen ihre Quelle geprüft ist.",
                "Research with every figure checked against its source.",
            ),
            Marke("marketing"),
        ),
        Szene(
            T("Prüfen", "Check"),
            T(
                "Jede Zahl wird im Text der Quelle gesucht, bevor ein Mensch den Befund liest.",
                "Every figure is looked up in the source text before a person reads the finding.",
            ),
            Blatt(
                T("Befund", "Finding"),
                (
                    (T("Aussage", "Statement"), T("mit Zahl", "with a figure")),
                    (T("Quelle", "Source"), T("Adresse und Datum", "address and date")),
                    (T("Prüfung", "Check"), T("Zahl im Quelltext gefunden", "figure found in the source")),
                ),
                T("Belegt", "Backed"),
            ),
        ),
        Szene(
            T("Kampagne", "Campaign"),
            T(
                "Nur behaltene Befunde kommen in die Kampagnen, und jede Zahl eines Beitrags braucht einen Beleg.",
                "Only kept findings go into campaigns, and every figure of a post needs a backing.",
            ),
            Kette(
                (
                    T("Recherche", "Research"),
                    T("Zahlen prüfen", "Check figures"),
                    T("Durchsicht", "Review"),
                    T("Kampagne", "Campaign"),
                )
            ),
        ),
        Szene(
            T("Planer", "Planner"),
            T(
                "Der Planer zeigt die Beiträge aller 13 Kanäle in einem Kalender.",
                "The planner shows the posts of all 13 channels in one calendar.",
            ),
            Liste(KANAELE),
        ),
        Szene(
            T("Posten", "Post"),
            T(
                "Ist der Termin da, erinnert das Cockpit. Gepostet wird von Hand über die Firmenkonten.",
                "When the date has come, the Cockpit reminds. Posting is done by hand from the company accounts.",
            ),
            Mitteilungen(
                (
                    Karte(
                        T("Jetzt posten: …", "Post now: …"),
                        T(
                            "Text kopieren, posten, dann als gepostet markieren",
                            "Copy the text, post it, then mark it as posted",
                        ),
                    ),
                )
            ),
        ),
    ),
    quellen=(
        "marketing/README.de.md",
        "marketing/src/agentic_marketing/verify.py",
        "marketing/src/agentic_marketing/review.py",
        "marketing/src/agentic_marketing/campaign.py",
        "marketing/src/agentic_marketing/freshness.py",
        "marketing/supabase/migrations/005_planer.sql",
        "marketing/supabase/migrations/006_firma.sql",
        "marketing/app/src/lib/tracking.ts",
    ),
)

TELEFON = Teil(
    id="telefon",
    name=T("Telefonassistentin", "Phone assistant"),
    kurz=T("Nimmt Anrufe an und schreibt ins CRM", "Answers calls and writes to the CRM"),
    satz=T(
        "Gebaut für den eigenen Server der Firma: nimmt Anrufe auf der Geschäftsnummer auf "
        "Deutsch an. Spracherkennung, Sprachmodell und Stimme laufen auf diesem Server mit seiner "
        "Grafikkarte; kein Cloud-Dienst ist beteiligt.",
        "Built for the company's own server: answers calls on the business number in German. "
        "Speech recognition, language model and voice run on that server with its graphics card; "
        "no cloud service is involved.",
    ),
    stand=T(
        "Die Geschäftsnummer wird eingetragen, sobald die Firma besteht.",
        "The business number is entered once the company exists.",
    ),
    faehig=(
        T(
            "Sagt zu Beginn, dass eine künstliche Intelligenz spricht und das Gespräch "
            "mitgeschrieben wird, wie es Artikel 50 der Verordnung (EU) 2024/1689 verlangt.",
            "Says at the start that an artificial intelligence is speaking and that the call is "
            "written down, as Article 50 of Regulation (EU) 2024/1689 requires.",
        ),
        T(
            "Antwortet nur aus den Angaben zum Betrieb und den aktiven Produkten im CRM; Preise, "
            "Termine oder Zusagen erfindet sie nie.",
            "Answers only from the business facts and the active products in the CRM; it never "
            "invents prices, dates or promises.",
        ),
        T(
            "Erkennt Anrufer an der Rufnummer, nach Ziffern verglichen; ein unbekannter Anrufer "
            "wird als Kunde angelegt, auch ohne E-Mail-Adresse.",
            "Recognises callers by their number, compared digit by digit; an unknown caller is "
            "added as a customer, even without an e-mail address.",
        ),
        T(
            "Nimmt das Anliegen auf und legt die Aufgabe „Rückruf <Name>, <Nummer>“ an; vorher "
            "fragt sie „Wie sind Sie auf uns aufmerksam geworden?“ und gibt den Kanal ans CRM.",
            "Takes down the request and creates the task “callback <name>, <number>”; before "
            "that it asks how the caller heard of the company and passes the channel to the CRM.",
        ),
        T(
            "Ein Rückrufwunsch wird ein Termin im Kalender des CRM, wenn die Zeit in der Zukunft, "
            "innerhalb von 60 Tagen und in den Geschäftszeiten liegt; sonst ein Rückruf heute "
            "ohne Uhrzeit, und die Notiz sagt, warum.",
            "A callback wish becomes an appointment in the CRM calendar when the time is in the "
            "future, within 60 days and in business hours; otherwise a callback today without a "
            "time, and the note says why.",
        ),
        T(
            "Nimmt Angebote an oder lehnt sie ab, aber nur, wenn die Leitung zum Kunden des "
            "Angebots gehört und das Angebot verschickt und noch gültig ist.",
            "Accepts or declines quotes, but only when the line belongs to the quote's customer "
            "and the quote has been sent and is still valid.",
        ),
        T(
            "Speichert jedes Gespräch mit Mitschrift und Zusammenfassung; kommt dasselbe "
            "Gespräch zweimal an, wird es einmal gespeichert.",
            "Stores every call with transcript and summary; if the same call arrives twice, it is stored once.",
        ),
        T(
            "Eine freie weibliche deutsche Stimme, bis Daniels eigene Stimme geklont ist.",
            "A free female German voice until Daniel's own voice is cloned.",
        ),
    ),
    verbindungen=(
        Verbindung(
            "crm",
            T(
                "fünf Funktionen: Anrufer nachschlagen, Anliegen aufnehmen, über ein Angebot "
                "entscheiden, Rückruf eintragen, Gespräch speichern.",
                "five functions: look up the caller, take a request, decide on a quote, enter a "
                "callback, store the call.",
            ),
        ),
        Verbindung(
            "cockpit",
            T(
                "„Anruf von …“ mit Zusammenfassung, „Rückruf gewünscht: …“; unklare Zusagen mit "
                "„Annahme bestätigen“. Die Spracherkennung schreibt auch die gesprochenen "
                "Anfragen an den Assistenten mit.",
                "“call from …” with summary, “callback requested: …”; unclear acceptances with "
                "“confirm acceptance”. The speech recognition also transcribes spoken requests to "
                "the assistant.",
            ),
        ),
    ),
    links=(github_ordner("telefon"),),
    ablauf_titel=T(
        "Ein Anruf, vom Klingeln bis zur Mitteilung",
        "One call, from the ring to the notification",
    ),
    ablauf_satz=T(
        "Sieben Stationen; an jeder steht, wer sie auslöst und wo sie läuft.",
        "Seven stations; each one says who triggers it and where it runs.",
    ),
    stationen=(
        Station(
            T("Anruf", "Call"),
            T(
                "Der Anbieter leitet die Geschäftsnummer über eine SIP-Leitung (Session "
                "Initiation Protocol) an den Server; LiveKit nimmt das Gespräch an.",
                "The provider routes the business number over a SIP trunk (Session Initiation "
                "Protocol) to the server; LiveKit takes the call.",
            ),
            EIGENER_SERVER,
            "selbst",
        ),
        Station(
            T("Begrüßung", "Greeting"),
            T(
                "Der Hinweis auf die künstliche Intelligenz steht in den Einstellungen des CRM; "
                "er lässt sich umformulieren, aber nicht leeren und nicht unterbrechen.",
                "The notice about the artificial intelligence sits in the CRM settings; it can be "
                "reworded, but not emptied and not interrupted.",
            ),
            EIGENER_SERVER,
            "selbst",
        ),
        Station(
            T("Gespräch", "Conversation"),
            T(
                "Spracherkennung mit faster-whisper, Antworten mit Qwen 3 über Ollama, Stimme mit "
                "Piper. Nach der eingestellten Höchstdauer verabschiedet sie sich.",
                "Speech recognition with faster-whisper, answers with Qwen 3 on Ollama, voice "
                "with Piper. After the configured maximum length it says goodbye.",
            ),
            EIGENER_SERVER,
            "selbst",
        ),
        Station(
            T("Anliegen aufnehmen", "Take the request"),
            T(
                "Kunden über die Rufnummer oder eine genannte E-Mail-Adresse finden oder anlegen, "
                "Anfrage und Rückruf-Aufgabe im CRM.",
                "Find or add the customer by number or a spoken e-mail address, enquiry and callback task in the CRM.",
            ),
            DATENBANK_CRM,
            "selbst",
        ),
        Station(
            T("Zusage oder Absage", "Acceptance or decline"),
            T(
                "Entschieden wird nur selbst, wenn Leitung, Kunde und Angebot zusammenpassen. Der "
                "Anrufer hört sonst immer denselben Satz und erfährt nichts über Angebote anderer "
                "Kunden.",
                "It is decided automatically only when line, customer and quote match. Otherwise "
                "the caller always hears the same sentence and learns nothing about other "
                "customers' quotes.",
            ),
            DATENBANK_CRM,
            "kunde",
        ),
        Station(
            T("Gesprächsende", "End of call"),
            T(
                "Das Sprachmodell auf dem Server fasst zusammen; Mitschrift, Zusammenfassung und "
                "Ergebnis kommen ins CRM, die Mitteilung „Anruf von …“ ins Cockpit.",
                "The language model on the server writes the summary; transcript, summary and "
                "outcome go into the CRM, the notification “call from …” into the Cockpit.",
            ),
            T("Server, CRM und Cockpit", "Server, CRM and Cockpit"),
            "selbst",
        ),
        Station(
            T("Rückruf und Bestätigung", "Callback and confirmation"),
            T(
                "Daniel ruft zurück und bestätigt eine unklare Zusage mit „Annahme bestätigen“.",
                "Daniel calls back and confirms an unclear acceptance with “confirm acceptance”.",
            ),
            T("CRM und Cockpit", "CRM and Cockpit"),
            "daniel",
        ),
    ),
    skills=(
        SkillGruppe(
            T("Telefonie", "Telephony"),
            (
                T("LiveKit-Server und LiveKit SIP", "LiveKit server and LiveKit SIP"),
                T("LiveKit Agents in Python", "LiveKit Agents in Python"),
                T("Valkey als Speicher für LiveKit", "Valkey as the store LiveKit needs"),
            ),
        ),
        SkillGruppe(
            T("Sprache", "Speech"),
            (
                T(
                    "Spracherkennung mit faster-whisper, Modell large-v3-turbo",
                    "Speech recognition with faster-whisper, model large-v3-turbo",
                ),
                T("Sprechpausen mit dem Silero-Modell", "Speech pauses with the Silero model"),
                T("Erkennung des Sprecherwechsels", "Turn detection"),
                T(
                    "Stimme mit Piper, deutsche Frauenstimme ramona",
                    "Voice with Piper, German female voice ramona",
                ),
                T("Sprachdienst mit FastAPI", "Speech service with FastAPI"),
            ),
        ),
        SkillGruppe(
            T("Sprachmodell", "Language model"),
            (
                T("Qwen 3 mit 8 Milliarden Parametern über Ollama", "Qwen 3 with 8 billion parameters on Ollama"),
                T(
                    "Werkzeuge: Anrufer nachschlagen, Anliegen aufnehmen, Angebot entscheiden, "
                    "Rückruf notieren, Gespräch beenden",
                    "Tools: look up the caller, take the request, decide on a quote, note a callback, end the call",
                ),
            ),
        ),
        SkillGruppe(
            T("Betrieb", "Operations"),
            (
                T(
                    "Docker Compose mit dem NVIDIA Container Toolkit, Grafikkarte ab 12 Gigabyte Speicher",
                    "Docker Compose with the NVIDIA Container Toolkit, graphics card with at "
                    "least 12 gigabytes of memory",
                ),
                T("Einstellungen mit pydantic-settings", "Settings with pydantic-settings"),
                T("Wiederholversuche mit tenacity", "Retries with tenacity"),
                T(
                    "Verhaltenstests mit echter Gesprächssitzung und einem Modell nach Drehbuch",
                    "Behaviour tests with a real call session and a scripted model",
                ),
                T(
                    "Nur freie Lizenzen: Apache 2.0, MIT, BSD und GPL 3.0",
                    "Free licences only: Apache 2.0, MIT, BSD and GPL 3.0",
                ),
            ),
        ),
    ),
    film_titel=T("Die Telefonassistentin in fünf Szenen", "The phone assistant in five scenes"),
    szenen=(
        Szene(
            T("Telefon", "Phone"),
            T(
                "Gebaut für den eigenen Server der Firma: nimmt Anrufe auf der Geschäftsnummer auf Deutsch an.",
                "Built for the company's own server: answers calls on the business number in German.",
            ),
            Marke("telefon"),
        ),
        Szene(
            T("Begrüßung", "Greeting"),
            T(
                "Zu Beginn sagt sie, dass eine künstliche Intelligenz spricht und das Gespräch mitgeschrieben wird.",
                "At the start it says that an artificial intelligence is speaking and that the call is written down.",
            ),
            Anruf(
                (
                    (
                        "assistentin",
                        T(
                            "Guten Tag, hier ist die digitale Assistentin von RepoCity. Ich bin "
                            "eine künstliche Intelligenz, kein Mensch.",
                            "Good day, this is RepoCity's digital assistant. I am an artificial "
                            "intelligence, not a human.",
                        ),
                    ),
                    (
                        "assistentin",
                        T(
                            "Unser Gespräch wird mitgeschrieben, damit Ihr Anliegen bearbeitet werden kann.",
                            "Our call is written down so that your request can be handled.",
                        ),
                    ),
                )
            ),
        ),
        Szene(
            T("Anliegen", "Request"),
            T(
                "Sie erkennt Anrufer an der Nummer, nimmt das Anliegen auf und legt eine Rückruf-Aufgabe im CRM an.",
                "It recognises callers by their number, takes down the request and creates a callback task in the CRM.",
            ),
            Kette(
                (
                    T("Rufnummer", "Number"),
                    T("Kunde", "Customer"),
                    T("Anfrage", "Enquiry"),
                    T("Rückruf-Aufgabe", "Callback task"),
                )
            ),
        ),
        Szene(
            T("Eigener Server", "Own server"),
            T(
                "Spracherkennung, Sprachmodell und Stimme sind gebaut für den eigenen Server der "
                "Firma, ohne Cloud-Dienst.",
                "Speech recognition, language model and voice are built for the company's own "
                "server, without a cloud service.",
            ),
            Liste(
                (
                    gleich("LiveKit"),
                    gleich("faster-whisper"),
                    T("Qwen 3 mit Ollama", "Qwen 3 on Ollama"),
                    gleich("Piper"),
                )
            ),
        ),
        Szene(
            T("Protokoll", "Record"),
            T(
                "Jedes Gespräch kommt mit Mitschrift und Zusammenfassung ins CRM und als Mitteilung ins Cockpit.",
                "Every call goes into the CRM with transcript and summary, and into the Cockpit as a notification.",
            ),
            Mitteilungen(
                (
                    Karte(
                        T("Anruf von …", "Call from …"),
                        T("Zusammenfassung des Gesprächs", "Summary of the call"),
                    ),
                )
            ),
        ),
    ),
    quellen=(
        "telefon/README.de.md",
        "telefon/pyproject.toml",
        "telefon/src/repocity_telefon/crm.py",
        "Dokumentation/INTEGRATION.de.md",
        "crm/README.de.md",
        "crm/supabase/migrations/005_calls.sql",
        "crm/supabase/migrations/009_kalender.sql",
        "crm/supabase/migrations/011_herkunft.sql",
    ),
)

MAIL = Teil(
    id="mail",
    name=T("Mail-Eingang", "Incoming mail"),
    kurz=T("Liest eingehende Mails und ordnet sie zu", "Reads incoming mail and files it"),
    satz=T(
        "Das Postfach der Firma wird alle fünf Minuten abgerufen. Mails bekannter Kunden kommen "
        "in ihre Akte; Antworten auf Angebote und Mails unbekannter Absender liest ein "
        "Sprachmodell und ordnet sie Kunden und Angeboten zu. Dieses Lesen ist gebaut für den "
        "eigenen Server der Firma.",
        "The company mailbox is fetched every five minutes. Mail from known customers goes into "
        "their file; replies to quotes and mail from unknown senders are read by a language "
        "model and assigned to customers and quotes. This reading is built for the company's "
        "own server.",
    ),
    stand=T(
        "Abruf und Ablage übernimmt der Postfach-Dienst des CRM. Teststand ohne Kundenbetrieb.",
        "Fetching and filing are done by the CRM's mail service. Test stage without customer operation.",
    ),
    faehig=(
        T(
            "Abruf alle fünf Minuten aus Posteingang und Gesendet; jede Mail eines bekannten "
            "Kunden kommt in seine Akte.",
            "Fetches inbox and sent mail every five minutes; every mail of a known customer goes into their file.",
        ),
        T(
            "Eine Mail eines Kunden mit verschicktem Angebot und jede Mail eines unbekannten "
            "Absenders wird zum Lesen vorgemerkt.",
            "A mail from a customer with a sent quote and every mail from an unknown sender is queued for reading.",
        ),
        T(
            "Prüft, ob der Absender nachweislich echt ist.",
            "Checks whether the sender is provably genuine.",
        ),
        T(
            "Das Sprachmodell liest jede Mail ohne Werkzeuge; der Mailtext gilt als Daten, nicht "
            "als Anweisung, und die Antwort wird gegen ein festes Format geprüft.",
            "The language model reads each mail without any tools; the mail text is treated as "
            "data, not as an instruction, and the answer is checked against a fixed format.",
        ),
        T(
            "Eine Annahme trägt das CRM nur selbst ein, wenn der Absender echt, die Antwort "
            "sicher und das Angebot eindeutig und noch gültig ist.",
            "The CRM records an acceptance by itself only when the sender is genuine, the answer "
            "is sure and the quote is unambiguous and still valid.",
        ),
        T(
            "Ist ein unbekannter Absender ein Kunde, legt das CRM ihn an und alle seine "
            "gespeicherten Mails in die Akte; alles andere landet in der Prüfliste.",
            "If an unknown sender is a customer, the CRM adds them and files all their stored "
            "mails; anything else lands on the review list.",
        ),
        T(
            "Steht im Betreff „Anfrage – über <Kanal> (<Kampagne>)“, wie ihn die Mail-Links der "
            "Webseiten setzen, übernimmt das CRM Kanal und Kampagne, auch in einer Antwort mit „AW:“.",
            "When the subject reads “Anfrage – über <channel> (<campaign>)”, as the mail links "
            "of the websites set it, the CRM takes over channel and campaign, also in a reply "
            "with “AW:”.",
        ),
        T(
            "Scheitert das Lesen dreimal, kommt eine Mitteilung; bleiben Mails eine Stunde "
            "ungelesen, meldet das Cockpit das einmal am Tag.",
            "If reading fails three times, a notification follows; if mail stays unread for an "
            "hour, the Cockpit reports it once a day.",
        ),
    ),
    verbindungen=(
        Verbindung(
            "crm",
            T(
                "trägt Kunden, Annahmen und Absagen ein.",
                "records customers, acceptances and declines.",
            ),
        ),
        Verbindung(
            "cockpit",
            T(
                "fragt bei unsicheren Fällen mit „Annahme bestätigen“ nach.",
                "asks about unsure cases with “confirm acceptance”.",
            ),
        ),
        Verbindung(
            "radarauditor",
            T(
                "das Lesen läuft im Container des RadarAuditors auf dem Server.",
                "the reading runs in the RadarAuditor's container on the server.",
            ),
        ),
    ),
    links=(github_ordner("crm/supabase/functions/crm-mail"),),
    ablauf_titel=T("Von der Mail bis zum Eintrag im CRM", "From the mail to the CRM entry"),
    ablauf_satz=T(
        "Sechs Stationen; an jeder steht, wer sie auslöst und wo sie läuft.",
        "Six stations; each one says who triggers it and where it runs.",
    ),
    stationen=(
        Station(
            T("Abruf", "Fetch"),
            T(
                "Alle fünf Minuten holt der Postfach-Dienst neue Mails aus Posteingang und Gesendet.",
                "Every five minutes the mail service fetches new mail from inbox and sent.",
            ),
            T("Postfach-Dienst des CRM", "CRM mail service"),
            "selbst",
        ),
        Station(
            T("Zuordnen", "Sort"),
            T(
                "Mail eines bekannten Kunden: in die Akte. Antwort auf ein verschicktes Angebot "
                "und unbekannter Absender: zum Lesen vorgemerkt, mit der Prüfung, ob der Absender "
                "echt ist.",
                "Mail of a known customer: into the file. Reply to a sent quote and unknown "
                "sender: queued for reading, with the check whether the sender is genuine.",
            ),
            T("Postfach-Dienst des CRM", "CRM mail service"),
            "selbst",
        ),
        Station(
            T("Lesen", "Read"),
            T(
                "Ein Sprachmodell liest jede vorgemerkte Mail ohne Werkzeuge; die Antwort wird "
                "gegen ein festes Format geprüft.",
                "A language model reads each queued mail without tools; the answer is checked against a fixed format.",
            ),
            EIGENER_SERVER,
            "selbst",
        ),
        Station(
            T("Eintragen", "Record"),
            T(
                "Sichere Annahme eines echten Absenders mit gültigem Angebot: Annahme im CRM. "
                "Sichere Absage: eingetragen und gemeldet. Neuer Kunde: angelegt, Mails in der "
                "Akte.",
                "Sure acceptance from a genuine sender with a valid quote: acceptance in the CRM. "
                "Sure decline: recorded and reported. New customer: added, mails in the file.",
            ),
            DATENBANK_CRM,
            "selbst",
        ),
        Station(
            T("Rückfrage", "Ask back"),
            T(
                "Alles andere kommt ins Cockpit, bei einer möglichen Annahme mit „Annahme "
                "bestätigen“ und dem Hinweis, ob das Angebot abgelaufen oder der Absender nicht "
                "bestätigt ist.",
                "Everything else goes to the Cockpit, a possible acceptance with “confirm "
                "acceptance” and a note whether the quote has expired or the sender is not "
                "confirmed.",
            ),
            gleich("Cockpit"),
            "daniel",
        ),
        Station(
            T("Wächter", "Watchdog"),
            T(
                "Werden Mails eine Stunde lang nicht gelesen, meldet das Cockpit das einmal am Tag.",
                "If mail is not read for an hour, the Cockpit reports it once a day.",
            ),
            ZEITPLAN,
            "selbst",
        ),
    ),
    skills=(
        SkillGruppe(
            T("Postfach-Dienst", "Mail service"),
            (
                DENO,
                T(
                    "Abruf per IMAP (Internet Message Access Protocol)",
                    "Fetching over IMAP (Internet Message Access Protocol)",
                ),
                T(
                    "Originalmails im Speicher, nach der Einordnung gelöscht",
                    "Original mails in storage, deleted after sorting",
                ),
            ),
        ),
        SkillGruppe(
            T("Echtheit des Absenders", "Sender authenticity"),
            (
                T(
                    "DMARC (Domain-based Message Authentication, Reporting and Conformance)",
                    "DMARC (Domain-based Message Authentication, Reporting and Conformance)",
                ),
                T(
                    "DKIM-Signatur (DomainKeys Identified Mail) der Absenderdomain",
                    "DKIM signature (DomainKeys Identified Mail) of the sender domain",
                ),
            ),
        ),
        SkillGruppe(
            T("Warteschlange", "Queue"),
            (
                T(
                    "Abholen mit „for update skip locked“, damit keine Mail doppelt gelesen wird",
                    "Claiming with “for update skip locked” so no mail is read twice",
                ),
                T("Bis zu drei Versuche, dann Mitteilung", "Up to three attempts, then a notice"),
            ),
        ),
        SkillGruppe(
            T("Lesen", "Reading"),
            (
                T("Sprachmodell ohne Werkzeuge", "Language model without tools"),
                T("Mailtext als Daten eingezäunt", "Mail text fenced as data"),
                T(
                    "Antwort gegen festes Format geprüft: Kunde, unsicher, kein Kunde oder "
                    "automatisch; Annahme, Absage oder anderes",
                    "Answer checked against a fixed format: customer, unsure, not a customer or "
                    "automated; accept, decline or other",
                ),
            ),
        ),
    ),
    film_titel=T("Der Mail-Eingang in fünf Szenen", "Incoming mail in five scenes"),
    szenen=(
        Szene(
            T("Mail-Eingang", "Incoming mail"),
            T(
                "Das Postfach der Firma wird alle fünf Minuten abgerufen.",
                "The company mailbox is fetched every five minutes.",
            ),
            Marke("mail"),
        ),
        Szene(
            T("Zuordnen", "Sort"),
            T(
                "Mails bekannter Kunden landen in ihrer Akte. Antworten auf Angebote und "
                "unbekannte Absender werden zum Lesen vorgemerkt.",
                "Mail from known customers lands in their file. Replies to quotes and unknown "
                "senders are queued for reading.",
            ),
            Nabe(
                T("Postfach", "Mailbox"),
                (
                    T("Kundenakte", "Customer file"),
                    T("Antwort auf Angebot", "Reply to a quote"),
                    T("Unbekannter Absender", "Unknown sender"),
                    T("Prüfliste", "Review list"),
                ),
            ),
        ),
        Szene(
            T("Lesen", "Read"),
            T(
                "Gebaut für den eigenen Server der Firma: Ein Sprachmodell liest jede vorgemerkte "
                "Mail, die Antwort wird gegen ein festes Format geprüft.",
                "Built for the company's own server: a language model reads each queued mail, and "
                "the answer is checked against a fixed format.",
            ),
            Blatt(
                T("Ergebnis des Lesens", "Reading result"),
                (
                    (T("Absicht", "Intent"), T("Annahme", "accept")),
                    (T("Sicherheit", "Confidence"), T("hoch", "high")),
                    (T("Angebot", "Quote"), gleich("AN-2026-0004")),
                ),
                T("Format geprüft", "Format checked"),
            ),
        ),
        Szene(
            T("Eintragen", "Record"),
            T(
                "Selbst eingetragen wird eine Annahme nur, wenn alle drei Bedingungen erfüllt sind.",
                "An acceptance is recorded automatically only when all three conditions hold.",
            ),
            Kette(
                (
                    T("Absender echt", "Sender genuine"),
                    T("Antwort sicher", "Answer sure"),
                    T("Angebot gültig", "Quote valid"),
                    T("Annahme eingetragen", "Acceptance recorded"),
                )
            ),
        ),
        Szene(
            T("Rückfrage", "Ask back"),
            T(
                "Alles andere kommt ins Cockpit, eine mögliche Annahme mit dem Knopf „Annahme bestätigen“.",
                "Everything else goes to the Cockpit, a possible acceptance with the button “confirm acceptance”.",
            ),
            Mitteilungen(
                (
                    Karte(
                        T("Mögliche Annahme: …", "Possible acceptance: …"),
                        T(
                            "Zusammenfassung · Hinweis zum Angebot",
                            "Summary · note on the quote",
                        ),
                        (T("Annahme bestätigen", "Confirm acceptance"),),
                    ),
                )
            ),
        ),
    ),
    quellen=(
        "crm/README.de.md",
        "Dokumentation/INTEGRATION.de.md",
        "crm/supabase/migrations/004_flow.sql",
        "crm/supabase/migrations/011_herkunft.sql",
    ),
)

WEBSEITEN = Teil(
    id="webseiten",
    name=T("Webseiten-Service", "Website service"),
    kurz=T("Webseiten aus dem Vorlagen-Baukasten", "Websites from a template kit"),
    satz=T(
        "Webseiten für Kunden entstehen aus einem Baukasten mit Vorlagen. Angebot, Auftrag und "
        "Rechnung laufen wie bei jedem Produkt der Firma über das CRM.",
        "Websites for customers are built from a kit of templates. Quote, order and invoice run "
        "through the CRM like every product of the company.",
    ),
    stand=T("Im Aufbau.", "In progress."),
    faehig=(
        T(
            "Webseiten für Kunden aus einem Baukasten mit Vorlagen.",
            "Websites for customers from a kit of templates.",
        ),
        T(
            "Der RadarAuditor misst, wie sichtbar die bisherige Webseite eines Betriebs ist.",
            "The RadarAuditor measures how visible a business's current website is.",
        ),
        T(
            "Kunden, Angebot, Auftrag und Rechnung führt das CRM.",
            "The CRM keeps customer, quote, order and invoice.",
        ),
        T(
            "Diese Firmenseite und die Hauptseite speedofthespirit.dev reichen die Herkunfts-Merker "
            "eines Besuchers (utm_source, utm_medium, utm_campaign) an Links auf die eigenen "
            "Seiten weiter und schreiben den Kanal in den Betreff eines Mail-Links; auf dem Gerät "
            "wird nichts gespeichert.",
            "This company page and the main site speedofthespirit.dev pass a visitor's origin "
            "markers (utm_source, utm_medium, utm_campaign) on to links to their own pages and "
            "write the channel into the subject of a mail link; nothing is stored on the device.",
        ),
    ),
    verbindungen=(
        Verbindung(
            "radarauditor",
            T(
                "misst die Sichtbarkeit einer Webseite mit 108 Prüfungen.",
                "measures a website's visibility with 108 checks.",
            ),
        ),
        Verbindung(
            "crm",
            T("führt Angebot, Auftrag und Rechnung.", "keeps quote, order and invoice."),
        ),
    ),
    links=(),
    ablauf_titel=T("Wo der Webseiten-Service im Ablauf steht", "Where the website service fits"),
    ablauf_satz=T(
        "Vier Stationen; an jeder steht, wer sie auslöst und wo sie läuft.",
        "Four stations; each one says who triggers it and where it runs.",
    ),
    stationen=(
        Station(
            T("Prüfung", "Audit"),
            T(
                "Der RadarAuditor misst die bisherige Webseite: Technik, Aufbau, Inhalte, "
                "Firmendaten und unsichtbare Angaben für Google.",
                "The RadarAuditor measures the current website: technology, structure, content, "
                "business details and hidden data for Google.",
            ),
            gleich("RadarAuditor"),
            "daniel",
        ),
        Station(
            T("Angebot", "Quote"),
            T(
                "Angebot mit Produkten und Preisen aus dem CRM, verschickt über das CRM.",
                "Quote with products and prices from the CRM, sent through the CRM.",
            ),
            gleich("CRM"),
            "daniel",
        ),
        Station(
            T("Bau", "Build"),
            T(
                "Die Webseite entsteht aus dem Baukasten mit Vorlagen.",
                "The website is built from the kit of templates.",
            ),
            T("Baukasten", "Template kit"),
            "offen",
        ),
        Station(
            T("Auftrag und Rechnung", "Order and invoice"),
            T(
                "Auftrag und Rechnung führt das CRM wie bei jedem Produkt.",
                "The CRM keeps order and invoice as for every product.",
            ),
            DATENBANK_CRM,
            "selbst",
        ),
    ),
    skills=(
        SkillGruppe(
            T("Baukasten", "Template kit"),
            (T("Vorlagen für Webseiten", "Website templates"),),
        ),
        SkillGruppe(
            T(
                "Was der RadarAuditor an einer Webseite misst",
                "What the RadarAuditor measures on a website",
            ),
            (
                T("Technik der Website: 10 Prüfungen", "Website technology: 10 checks"),
                T("Aufbau der Seiten: 10 Prüfungen", "Page structure: 10 checks"),
                T("Inhalte und Leistungsseiten: 12 Prüfungen", "Content and service pages: 12 checks"),
                T("Firmendaten auf der Website: 6 Prüfungen", "Business details on the website: 6 checks"),
                T(
                    "Unsichtbare Angaben für Google und KI: 8 Prüfungen",
                    "Hidden data for Google and AI: 8 checks",
                ),
            ),
        ),
    ),
    film_titel=T("Der Webseiten-Service in drei Szenen", "The website service in three scenes"),
    szenen=(
        Szene(
            T("Webseiten", "Websites"),
            T(
                "Webseiten für Kunden entstehen aus einem Baukasten mit Vorlagen.",
                "Websites for customers are built from a kit of templates.",
            ),
            Marke("webseiten"),
        ),
        Szene(
            T("Messen", "Measure"),
            T(
                "Der RadarAuditor misst an einer Webseite Technik, Aufbau, Inhalte, Firmendaten "
                "und unsichtbare Angaben für Google.",
                "The RadarAuditor measures a website's technology, structure, content, business "
                "details and hidden data for Google.",
            ),
            Liste(BEREICHE[:5]),
        ),
        Szene(
            T("Ablauf", "Flow"),
            T(
                "Angebot, Auftrag und Rechnung laufen wie bei jedem Produkt der Firma über das CRM.",
                "Quote, order and invoice run through the CRM like every product of the company.",
            ),
            Kette(
                (
                    T("Prüfung", "Audit"),
                    T("Angebot", "Quote"),
                    T("Webseite", "Website"),
                    T("Rechnung", "Invoice"),
                )
            ),
        ),
    ),
    quellen=(
        "radarauditor/config/pruefkatalog.yaml",
        "Dokumentation/INTEGRATION.de.md",
        "README.de.md",
        "repocity-seite/site/js/herkunft.js",
    ),
)

TEILE: tuple[Teil, ...] = (COCKPIT, CRM, MAIL, TELEFON, RADARAUDITOR, WEBSEITEN, MARKETING)
"""Order around the mark, clockwise from the top: the Cockpit sits above every app."""
