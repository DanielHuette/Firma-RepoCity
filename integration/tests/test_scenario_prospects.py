"""P1 to P17: a business from the customer search goes into the CRM as a prospect.

Context: The RadarAuditor app asks for a search, the worker stores the ranked list, Daniel takes a
result into the CRM with "Ins CRM als Interessent" (public.add_prospect_to_crm, migration 016). |
Input: the built project. | Output: Assertions on CRM customers, deals, the customer file and the
Cockpit.
"""

import json
from typing import Any

import psycopg
import pytest
from steps import titles

from repocity_integration.database import ADMIN, ANON, READER, SERVICE, Database
from repocity_integration.project import migration_sql

REASONS = "Keine Webseite im Profil und keine Fotos."


def _result(place_id: str, name: str, **changes: object) -> dict[str, Any]:
    return {
        "rank": 1,
        "place_id": place_id,
        "name": name,
        "address": "Ludgeristraße 1, 48143 Münster, Deutschland",
        "street": "Ludgeristraße 1",
        "postal_code": "48143",
        "city": "Münster",
        "phone": "0251 4711",
        "website": None,
        "maps_url": "https://maps.google.com/?cid=1",
        "rating": 4.1,
        "review_count": 3,
        "photo_count": 0,
        "has_opening_hours": False,
        "score": 5,
        "signals": ["no_website", "no_photos"],
        "reasons": REASONS,
        "contact_ways": [],
        **changes,
    }


def _search_with(db: Database, *results: dict[str, Any]) -> list[str]:
    """The app asks for "Bäcker in Münster", the worker stores the results; ids by rank."""
    search: str = db.value(
        "select public.request_prospect_search('Bäcker', 'Münster')", caller=ADMIN
    )
    db.run("select * from public.claim_prospect_search()", caller=SERVICE)
    ranked = [{**result, "rank": rank} for rank, result in enumerate(results, start=1)]
    db.run(
        "select public.finish_prospect_search(%s, %s::jsonb)",
        (search, json.dumps(ranked)),
        SERVICE,
    )
    return [
        row["id"]
        for row in db.rows("select id from public.prospect_results order by rank", caller=READER)
    ]


def _add(
    db: Database,
    result: str,
    name: str = "Bäckerei Korn",
    phone: str = "0251 4711",
    city: str = "Münster",
) -> str:
    """Daniel clicks "Ins CRM als Interessent" with name, address and phone from the profile."""
    customer: str = db.value(
        "select public.add_prospect_to_crm(p_result => %s, p_name => %s, p_street => %s, "
        "p_postal_code => %s, p_city => %s, p_phone => %s)",
        (result, name, "Ludgeristraße 1", "48143", city, phone),
        ADMIN,
    )
    return customer


def test_p1_a_result_becomes_a_prospect_with_an_open_deal(db: Database) -> None:
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))

    customer = _add(db, result)

    assert db.one("select name, phone, street, postal_code, city, source from crm.customers") == {
        "name": "Bäckerei Korn",
        "phone": "0251 4711",
        "street": "Ludgeristraße 1",
        "postal_code": "48143",
        "city": "Münster",
        "source": "radarauditor",
    }
    assert db.one("select customer_id, title, stage, next_step from crm.deals") == {
        "customer_id": customer,
        "title": "Interessent aus der Kundensuche „Bäcker in Münster“",
        "stage": "new",
        "next_step": (
            "Erstkontakt per Brief oder Besuch; keine Werbe-Mail, kein Anruf ohne konkreten Anlass."
        ),
    }
    activity = db.value("select body from crm.activities where customer_id = %s", (customer,))
    assert activity == "Als Interessent aus der Kundensuche „Bäcker in Münster“ übernommen."
    assert not any(title.startswith("Neuer Kunde") for title in titles(db))


def test_p2_taking_the_same_result_twice_changes_nothing(db: Database) -> None:
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))

    first = _add(db, result)

    assert _add(db, result) == first
    assert db.value("select count(*) from crm.customers") == 1
    assert db.value("select count(*) from crm.deals") == 1


def test_p3_a_known_crm_customer_is_linked_not_created_twice(db: Database) -> None:
    known: str = db.value(
        "insert into crm.customers (name, city) values ('Bäckerei Korn', 'Münster') returning id"
    )
    db.run("insert into crm.deals (customer_id, title) values (%s, 'Schon im Gespräch')", (known,))
    [result] = _search_with(db, _result("ChIJ-korn", "bäckerei korn"))

    assert _add(db, result, name="bäckerei korn") == known
    assert db.value("select count(*) from crm.customers") == 1
    assert db.value("select title from crm.deals") == "Schon im Gespräch"


def test_p4_a_business_that_objected_to_advertising_is_refused(db: Database) -> None:
    db.run(
        "insert into crm.customers (name, city, no_follow_ups) "
        "values ('Bäckerei Korn', 'Münster', true)"
    )
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))

    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="widersprochen"):
        _add(db, result)
    assert db.value("select count(*) from crm.deals") == 0


def test_p5_a_reader_cannot_take_a_result_into_the_crm(db: Database) -> None:
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))

    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="Nur der Administrator"):
        db.run(
            "select public.add_prospect_to_crm(%s, 'Bäckerei Korn', '', '', 'Münster', '')",
            (result,),
            READER,
        )
    assert db.value("select count(*) from crm.customers") == 0


def _objected_customer(db: Database, name: str, phone: str = "") -> str:
    """A CRM customer who used the opt-out link: no advertising any more."""
    customer: str = db.value(
        "insert into crm.customers (name, city, phone) values (%s, 'Münster', %s) returning id",
        (name, phone),
    )
    db.run("update crm.customers set no_follow_ups = true where id = %s", (customer,))
    return customer


def test_p6_an_objection_holds_although_a_second_customer_has_the_same_name(db: Database) -> None:
    _objected_customer(db, "Bäckerei Korn")
    db.run("insert into crm.customers (name, city) values ('Bäckerei Korn', 'Münster')")
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))

    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="widersprochen"):
        _add(db, result)
    assert db.value("select count(*) from crm.customers") == 2
    assert db.value("select count(*) from crm.deals") == 0


def test_p7_an_objection_is_found_by_the_phone_number_under_another_name(db: Database) -> None:
    _objected_customer(db, "Bäckerei Korn GmbH & Co. KG", phone="+49 251 4711")
    [result] = _search_with(db, _result("ChIJ-korn", "Backstube am Dom", phone="0251/4711"))

    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="widersprochen"):
        _add(db, result, name="Backstube am Dom", phone="0251/4711")


def test_p8_an_objection_outlasts_the_deletion_of_the_customer(db: Database) -> None:
    [first] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))
    customer = _add(db, first)
    db.run("update crm.customers set no_follow_ups = true where id = %s", (customer,))
    db.run("delete from crm.deals; delete from crm.activities; delete from crm.customers")
    db.run("delete from public.prospect_results; delete from public.prospect_searches")
    [again] = _search_with(db, _result("ChIJ-korn", "Neuer Name", phone=None))

    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="widersprochen"):
        _add(db, again, name="Neuer Name", phone="")
    assert db.value("select count(*) from crm.customers") == 0


def test_p9_the_result_list_marks_who_objected(db: Database) -> None:
    _objected_customer(db, "Bäckerei Korn")
    rows = _search_with(
        db, _result("ChIJ-korn", "Bäckerei Korn"), _result("ChIJ-hof", "Hofbäckerei", phone=None)
    )

    marks = db.rows("select place_id, objected from public.prospect_results order by rank")
    assert marks == [
        {"place_id": "ChIJ-korn", "objected": True},
        {"place_id": "ChIJ-hof", "objected": False},
    ]
    _objected_customer(db, "Hofbäckerei")
    assert (
        db.value("select objected from public.prospect_results where id = %s", (rows[1],)) is True
    )


def test_p10_the_app_reads_searches_and_results_but_writes_only_through_the_functions(
    db: Database,
) -> None:
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))

    assert db.value("select count(*) from public.prospect_results", caller=ADMIN) == 1
    for statement in (
        "insert into public.prospect_searches (trade, city) values ('Maler', 'Münster')",
        "update public.prospect_searches set status = 'queued'",
        "update public.prospect_results set name = 'x'",
        "delete from public.prospect_results",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.run(statement, caller=ADMIN)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select count(*) from public.prospect_results", caller=ANON)
    assert db.value("select name from public.prospect_results where id = %s", (result,)) == (
        "Bäckerei Korn"
    )


def test_p11_running_016_and_cockpit_008_again_keeps_rows_rights_and_row_rules(
    db: Database,
) -> None:
    _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))
    db.run(
        "insert into crm.customers (name, city, no_follow_ups) "
        "values ('Maler Kort', 'Münster', true)"
    )

    for path in (
        "radarauditor/supabase/migrations/016_kundensuche_monatsservice.sql",
        "cockpit/supabase/migrations/008_monatsservice.sql",
    ):
        db.run(migration_sql(path).encode())

    assert db.value("select count(*) from public.prospect_results") == 1
    assert db.value("select count(*) from public.advertising_objections") == 1
    assert db.rows(
        "select relname, relrowsecurity from pg_class where relname in "
        "('prospect_searches', 'prospect_results', 'advertising_objections') order by relname"
    ) == [
        {"relname": "advertising_objections", "relrowsecurity": True},
        {"relname": "prospect_results", "relrowsecurity": True},
        {"relname": "prospect_searches", "relrowsecurity": True},
    ]
    executable = db.rows(
        "select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, "
        "has_function_privilege('authenticated', p.oid, 'execute') as authenticated "
        "from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in "
        "('request_prospect_search', 'add_prospect_to_crm', 'claim_prospect_search', "
        "'finish_prospect_search', 'fail_prospect_search', 'purge_prospect_searches', "
        "'queue_monthly_service', 'prospect_objected', 'record_advertising_objection') "
        "order by p.proname"
    )
    app_functions = {"add_prospect_to_crm", "request_prospect_search"}
    assert all(not row["anon"] for row in executable)
    assert {row["proname"] for row in executable if row["authenticated"]} == app_functions
    unpinned = db.rows(
        "select p.proname from pg_proc p where p.prosecdef and p.proconfig is null "
        "and p.pronamespace in ('public'::regnamespace, 'cockpit'::regnamespace)"
    )
    assert unpinned == []

    assert db.value("select count(*) from cron.job where jobname = 'radar-prospect-purge'") == 1


def _refused(db: Database, result: str, **typed: str) -> None:
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="widersprochen"):
        _add(db, result, **typed)
    assert db.value("select objected from public.prospect_results where id = %s", (result,))
    assert db.value("select count(*) from crm.deals") == 0


def test_p12_an_objection_without_city_holds_in_every_city(db: Database) -> None:
    db.run("insert into crm.customers (name, no_follow_ups) values ('Bäckerei Korn', true)")
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn", phone="0251 9999"))

    _refused(db, result, phone="0251 9999")


def test_p13_a_city_with_an_addition_in_brackets_is_the_same_city(db: Database) -> None:
    db.run(
        "insert into crm.customers (name, city, no_follow_ups) "
        "values ('Bäckerei Korn', 'Münster (Westf.)', true)"
    )
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn", phone="0251 9999"))

    _refused(db, result, phone="0251 9999")


def test_p14_an_owner_added_to_the_profile_name_does_not_hide_the_objection(
    db: Database,
) -> None:
    db.run(
        "insert into crm.customers (name, city, no_follow_ups) "
        "values ('Bäckerei Korn', 'Münster', true)"
    )
    owner = "Bäckerei Korn Inh. Peter Müller"
    [result] = _search_with(db, _result("ChIJ-korn", owner, phone="0251 9999"))

    _refused(db, result, name=owner, phone="0251 9999")


def test_p15_a_name_typed_differently_without_phone_is_still_refused(db: Database) -> None:
    db.run(
        "insert into crm.customers (name, city, phone, no_follow_ups) "
        "values ('Bäckerei Korn', 'Münster', '0251 4711', true)"
    )
    [result] = _search_with(db, _result("ChIJ-korn", "Bäckerei Korn"))

    _refused(db, result, name="Backstube K.", phone="")


def test_p16_another_bakery_in_the_city_stays_open(db: Database) -> None:
    db.run(
        "insert into crm.customers (name, city, no_follow_ups) "
        "values ('Bäckerei Korn', 'Münster', true)"
    )
    [result] = _search_with(db, _result("ChIJ-hof", "Hofbäckerei Weber", phone="0251 9999"))

    _add(db, result, name="Hofbäckerei Weber", phone="0251 9999")
    assert db.value("select count(*) from crm.deals") == 1


def test_p17_the_database_empties_old_lists_every_hour_without_the_worker(db: Database) -> None:
    [kept] = _search_with(
        db, _result("ChIJ-korn", "Bäckerei Korn"), _result("ChIJ-gone", "Konditorei Y")
    )[:1]
    _add(db, kept)
    db.run("update public.prospect_searches set fetched_at = now() - interval '25 hours'")
    job = db.one("select schedule, command from cron.job where jobname = 'radar-prospect-purge'")

    db.run(job["command"])

    minute, hour = job["schedule"].split()[:2]
    assert int(minute) not in (0, 30) and hour == "*"
    assert db.value("select status from public.prospect_searches") == "expired"
    assert db.rows("select place_id, name, phone from public.prospect_results") == [
        {"place_id": "ChIJ-korn", "name": "", "phone": None}
    ]
