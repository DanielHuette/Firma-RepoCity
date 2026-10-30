"""The readers behind the caller check, on small samples of each source style.

Context: The caller check is only as good as its reading of PostgREST select lists, REST paths,
supabase-js chains, REST helper calls, TypeScript types and Python repositories. | Input: short
source snippets. | Output: Assertions on the references read from them.
"""

import ast

import pytest

from repocity_integration.references import Embed, parse_rest_path, parse_select
from repocity_integration.scan_py import Module, model_fields, python_references
from repocity_integration.scan_ts import TsFile, helper_references, supabase_references
from repocity_integration.tsparse import TypeIndex, constants_of


def _ts(text: str) -> TsFile:
    types = TypeIndex()
    types.add_source(text)
    return TsFile("app.ts", text, constants_of(text), types, text)


def test_a_select_list_has_columns_aliases_casts_and_nested_embeds() -> None:
    selected = parse_select(
        "*, total:gross::text, data->>error, customer:customers!inner(id, a(b))"
    )

    assert selected.columns == {"gross", "data"}
    assert selected.embeds == [
        Embed("customers", frozenset({"id"}), (Embed("a", frozenset({"b"})),))
    ]


def test_a_select_item_that_is_no_column_is_refused() -> None:
    with pytest.raises(ValueError, match="not understood"):
        parse_select("count(*) + 1")


def test_a_rest_path_names_filter_order_and_select_columns() -> None:
    table, selected, columns = parse_rest_path(
        "documents?kind=eq.invoice&data->>quote_id=eq.${id}&order=created_at.desc&limit=1"
        "&select=file_path"
    )

    assert (table, selected.columns, columns) == (
        "documents",
        {"file_path"},
        {"kind", "data", "created_at"},
    )


def test_a_supabase_chain_across_lines_with_a_schema_and_a_typed_payload() -> None:
    file = _ts(
        "interface Draft { name: string; city?: string }\n"
        'const FIELDS = "id, " + "name";\n'
        "export async function save(id: string, draft: Partial<Draft>) {\n"
        '  await supabase.schema("crm")\n    .from("customers").update(draft).eq("id", id)'
        ".select(FIELDS).single<Draft>();\n}\n"
    )

    [reference] = list(supabase_references(file, "public", "authenticated"))

    assert (reference.schema, reference.name, reference.action) == ("crm", "customers", "update")
    assert reference.columns == {"id", "name", "city"}


def test_a_table_passed_as_parameter_is_read_at_every_call_site() -> None:
    file = _ts(
        "async function clear(table: string, key: string, id: string) {\n"
        "  await supabase.from(table).delete().eq(key, id);\n}\n"
        'await clear("quote_items", "quote_id", a);\n'
        'await clear("invoice_items", "invoice_id", b);\n'
    )

    found = {
        (r.name, frozenset(r.columns)) for r in supabase_references(file, "crm", "authenticated")
    }

    assert found == {
        ("quote_items", frozenset({"quote_id"})),
        ("invoice_items", frozenset({"invoice_id"})),
    }


def test_rest_helpers_give_table_conflict_and_payload() -> None:
    file = _ts(
        'await insert("emails", { message_id: m, subject }, "message_id");\n'
        'await patch("outbox", `id=eq.${id}`, { status: "sent" });\n'
        'await select(`documents?kind=eq.audit_quote&select=file_path`, "public");\n'
    )

    found = [
        (r.action, r.schema, r.name, r.columns, r.conflict)
        for r in helper_references(file, "crm", "service_role")
    ]

    assert found == [
        ("insert", "crm", "emails", frozenset({"message_id", "subject"}), ("message_id",)),
        ("update", "crm", "outbox", frozenset({"id", "status"}), ()),
        ("select", "public", "documents", frozenset({"kind", "file_path"}), ()),
    ]


def test_python_rows_from_dicts_comprehensions_and_model_dumps() -> None:
    source = (
        "class Job(BaseModel):\n    id: UUID\n    kind: str\n    error: str | None\n"
        "class Repo:\n"
        "    def save(self, job: Job) -> None:\n"
        '        self._client.table("jobs").insert(job.model_dump(exclude={"error"})).execute()\n'
        "    def touch(self, job_id: UUID, error: str | None) -> None:\n"
        '        values = {key: value for key, value in (("error", error),) if value}\n'
        '        values["kind"] = "x"\n'
        '        self._crm().table("jobs").update(values).eq("id", str(job_id))\n'
    )
    module = Module("repo.py", ast.parse(source), model_fields([source]))

    found = [(r.schema, r.action, r.columns) for r in python_references(module)]

    assert found == [
        ("public", "insert", frozenset({"id", "kind"})),
        ("crm", "update", frozenset({"error", "kind", "id"})),
    ]
