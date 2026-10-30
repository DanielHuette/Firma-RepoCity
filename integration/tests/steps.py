"""Business steps the tests build on: company data, products, a customer from an audit, a quote.

Context: Each step does what the apps do, through the same functions and as the same caller. |
Input: a test database. | Output: ids of what the step created.
"""

from typing import Any

from repocity_integration.database import ADMIN, SERVICE, Database

ONCE_PRICE = 900
MONTHLY_PRODUCT_PRICE = 99
MONTHLY_QUOTED_PRICE = 79
CUSTOMER_EMAIL = "info@baeckerei-korn.de"


def set_company(db: Database) -> None:
    """Fill in the company data an invoice needs."""
    db.run(
        "update crm.settings set company_name = 'RepoCity', owner_name = 'Daniel Hütte', "
        "street = 'Musterweg 1', postal_code = '48143', city = 'Münster', "
        "tax_number = '337/5000/0000', iban = 'DE02120300000000202051', small_business = false"
    )


def add_products(db: Database) -> tuple[str, str]:
    """A one-off optimisation and a monthly service that covers catalogue area a.

    Returns:
        Ids of the one-off product and the monthly product.
    """
    once: str = db.value(
        "insert into crm.products (name, price_net, vat_rate, billing) "
        "values ('Website-Optimierung', %s, 19, 'once') returning id",
        (ONCE_PRICE,),
    )
    monthly: str = db.value(
        "insert into crm.products (name, unit, price_net, vat_rate, billing, radar_areas) "
        "values ('Monatliche Pflege', 'Monat', %s, 19, 'monthly', '{a}') returning id",
        (MONTHLY_PRODUCT_PRICE,),
    )
    return once, monthly


def audited_customer(db: Database, email: str | None = CUSTOMER_EMAIL) -> str:
    """Start a field audit in the RadarAuditor app and give the CRM customer an e-mail address.

    Returns:
        Id of the CRM customer the audit created.
    """
    db.value(
        "select public.start_field_audit('baeckerei-korn.de', p_name => 'Bäckerei Korn', "
        "p_city => 'Münster', p_industry => 'Bäckerei')",
        caller=ADMIN,
    )
    customer: str = db.value("select id from crm.customers where name = 'Bäckerei Korn'")
    db.run(
        "update crm.customers set email = %s, contact_person = 'Erika Korn' where id = %s",
        (email, customer),
    )
    return customer


def quote_with_items(db: Database, customer: str, once: str | None, monthly: str | None) -> str:
    """Create a quote in the app with a one-off item and a monthly item at a reduced price."""
    quote: str = db.value("select (crm.create_quote(%s)).id", (customer,), ADMIN)
    if once is not None:
        db.run(
            "insert into crm.quote_items (quote_id, position, product_id, title, unit_price_net) "
            "values (%s, 1, %s, 'Website-Optimierung', %s)",
            (quote, once, ONCE_PRICE),
            ADMIN,
        )
    if monthly is not None:
        db.run(
            "insert into crm.quote_items "
            "(quote_id, position, product_id, title, unit, unit_price_net) "
            "values (%s, 2, %s, 'Monatliche Pflege', 'Monat', %s)",
            (quote, monthly, MONTHLY_QUOTED_PRICE),
            ADMIN,
        )
    return quote


def sent_quote(db: Database, customer: str, once: str | None, monthly: str | None) -> str:
    """Create a quote and send it from the app."""
    quote = quote_with_items(db, customer, once, monthly)
    db.run("select crm.send_quote(%s)", (quote,), ADMIN)
    return quote


def accepted_order(db: Database) -> dict[str, Any]:
    """Company data, products, an audited customer and a sent quote the app accepted.

    Returns:
        Ids under customer, quote, order, once and monthly.
    """
    set_company(db)
    once, monthly = add_products(db)
    customer = audited_customer(db)
    quote = sent_quote(db, customer, once, monthly)
    order: str = db.value("select (crm.accept_quote(%s)).id", (quote,), ADMIN)
    return {"customer": customer, "quote": quote, "order": order, "once": once, "monthly": monthly}


def finish_optimization(db: Database, order: str) -> None:
    """The worker applies the only change of the order, which ends the optimisation."""
    customer: str = db.value(
        "select c.id from public.customers c "
        "join crm.orders o on o.customer_id = c.crm_customer_id where o.id = %s",
        (order,),
    )
    job: str = db.value(
        "insert into public.jobs (kind, status, customer_id, order_id) "
        "values ('apply', 'running', %s, %s) returning id",
        (customer, order),
        SERVICE,
    )
    db.run(
        "insert into public.optimization_changes (order_id, target, after, status) "
        "values (%s, 'website', 'neuer Titel', 'applied')",
        (order,),
        SERVICE,
    )
    db.run("update public.jobs set status = 'done' where id = %s", (job,), SERVICE)


def messages(db: Database) -> list[dict[str, Any]]:
    """Cockpit messages, oldest first."""
    return db.rows(
        "select app, kind, title, body, link, priority, tag, actions, action_payload "
        "from cockpit.messages order by created_at, title"
    )


def titles(db: Database) -> list[str]:
    """Titles of the Cockpit messages, oldest first."""
    return [message["title"] for message in messages(db)]


def outbox(db: Database) -> list[dict[str, Any]]:
    """Queued mails, oldest first."""
    return db.rows(
        "select id, kind, to_address, subject, body, quote_id, invoice_id, review_request_id, "
        "dunning_level, contract_id, approval_id, status from crm.outbox order by created_at, kind"
    )
