"""Compare what the callers ask of the database with what the built database offers.

Context: The scanners read every database call of the apps, the Edge Functions and the RadarAuditor
worker; this module reads functions, tables, columns, rights, row level security policies, foreign
keys and unique keys from the system catalog and names every call that would fail. | Input: an open
psycopg connection to the built project and the references. | Output: Catalog and check_all.
"""

from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row

from repocity_integration.references import Embed, Reference

_FUNCTIONS = """
select n.nspname as schema, p.proname as name, p.oid,
       case when p.proargnames is null then '{}' else (
         select coalesce(array_agg(a.name order by a.position), '{}')
           from unnest(p.proargnames, coalesce(p.proargmodes::text[],
                       array_fill('i'::text, array[cardinality(p.proargnames)])))
                with ordinality a(name, mode, position)
          where a.mode in ('i', 'b', 'v')) end as arguments,
       p.pronargdefaults as defaults,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'crm', 'cockpit')
"""
_COLUMNS = """
select c.table_schema as schema, c.table_name as name, array_agg(c.column_name::text) as columns
  from information_schema.columns c where c.table_schema in ('public', 'crm', 'cockpit')
 group by 1, 2
"""
_TABLES = """
select n.nspname as schema, c.relname as name, c.relrowsecurity as rls,
       array(select r || ' ' || lower(p)
               from unnest(array['anon', 'authenticated', 'service_role']) r,
                    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
              where has_table_privilege(r, c.oid, p)) as rights
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'crm', 'cockpit') and c.relkind in ('r', 'v', 'p')
"""
_POLICIES = (
    "select schemaname as schema, tablename as name, roles::text[] as roles, cmd from pg_policies"
)
_RELATIONS = """
select cn.nspname || '.' || c.relname as child, pn.nspname || '.' || p.relname as parent
  from pg_constraint k join pg_class c on c.oid = k.conrelid
  join pg_namespace cn on cn.oid = c.relnamespace
  join pg_class p on p.oid = k.confrelid join pg_namespace pn on pn.oid = p.relnamespace
 where k.contype = 'f'
"""
_UNIQUE = """
select n.nspname || '.' || c.relname as name,
       array_agg(a.attname::text order by a.attname) as columns
  from pg_index i join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
 where i.indisunique and i.indpred is null and i.indexprs is null
 group by i.indexrelid, 1
"""
_POLICY_COMMANDS = {"select": "SELECT", "insert": "INSERT", "update": "UPDATE", "delete": "DELETE"}


@dataclass
class Catalog:
    """Functions, tables and rights of the built project, keyed by schema and name."""

    functions: dict[tuple[str, str], list[dict[str, Any]]]
    columns: dict[tuple[str, str], set[str]]
    tables: dict[tuple[str, str], dict[str, Any]]
    policies: dict[tuple[str, str], list[dict[str, Any]]]
    relations: set[tuple[str, str]]
    unique: dict[str, list[set[str]]]

    @classmethod
    def read(cls, connection: psycopg.Connection[dict[str, Any]]) -> "Catalog":
        """Read the catalog once."""

        def grouped(sql: str) -> dict[tuple[str, str], list[dict[str, Any]]]:
            result: dict[tuple[str, str], list[dict[str, Any]]] = {}
            for row in connection.execute(sql.encode()).fetchall():
                result.setdefault((row["schema"], row["name"]), []).append(row)
            return result

        unique: dict[str, list[set[str]]] = {}
        for row in connection.execute(_UNIQUE.encode()).fetchall():
            unique.setdefault(row["name"], []).append(set(row["columns"]))
        return cls(
            functions=grouped(_FUNCTIONS),
            columns={k: set(v[0]["columns"]) for k, v in grouped(_COLUMNS).items()},
            tables={k: v[0] for k, v in grouped(_TABLES).items()},
            policies=grouped(_POLICIES),
            relations={(r["child"], r["parent"]) for r in connection.execute(_RELATIONS.encode())},
            unique=unique,
        )


def read_catalog(conninfo: str) -> Catalog:
    """Connect, read the catalog and disconnect."""
    with psycopg.connect(conninfo, autocommit=True, row_factory=dict_row) as connection:
        return Catalog.read(connection)


def _check_rpc(catalog: Catalog, reference: Reference) -> list[str]:
    overloads = catalog.functions.get((reference.schema, reference.name), [])
    if not overloads:
        return [f"function {reference.schema}.{reference.name} does not exist"]
    for overload in overloads:
        names = list(overload["arguments"])
        required = set(names[: len(names) - overload["defaults"]])
        if reference.arguments <= set(names) and required <= reference.arguments:
            return (
                []
                if overload[reference.role]
                else [f"{reference.role} may not run {reference.name}"]
            )
    shapes = "; ".join(", ".join(o["arguments"]) for o in overloads)
    return [
        f"{reference.name}({', '.join(sorted(reference.arguments))}) fits no signature ({shapes})"
    ]


def _check_embeds(
    catalog: Catalog, schema: str, table: str, embeds: tuple[Embed, ...]
) -> list[str]:
    problems: list[str] = []
    for embed in embeds:
        key = (schema, embed.table)
        if key not in catalog.columns:
            problems.append(f"embedded table {schema}.{embed.table} does not exist")
            continue
        here, there = f"{schema}.{table}", f"{schema}.{embed.table}"
        if (here, there) not in catalog.relations and (there, here) not in catalog.relations:
            problems.append(f"no foreign key between {here} and {there} for the embed")
        missing = embed.columns - catalog.columns[key]
        problems += [f"column {schema}.{embed.table}.{c} does not exist" for c in sorted(missing)]
        problems += _check_embeds(catalog, schema, embed.table, embed.embeds)
    return problems


def _rights(catalog: Catalog, reference: Reference, table: dict[str, Any]) -> list[str]:
    actions = ["insert", "update"] if reference.action == "upsert" else [reference.action]
    problems: list[str] = []
    for action in actions:
        if f"{reference.role} {action}" not in table["rights"]:
            problems.append(f"{reference.role} has no {action} right on {reference.name}")
        elif (
            table["rls"]
            and reference.role != "service_role"
            and not any(
                policy["cmd"] in ("ALL", _POLICY_COMMANDS[action])
                and set(policy["roles"]) & {reference.role, "public"}
                for policy in catalog.policies.get((reference.schema, reference.name), [])
            )
        ):
            problems.append(
                f"no row level security policy lets {reference.role} {action} {reference.name}"
            )
    return problems


def _check_conflict(catalog: Catalog, reference: Reference) -> list[str]:
    if not reference.conflict:
        return []
    keys = catalog.unique.get(f"{reference.schema}.{reference.name}", [])
    if set(reference.conflict) in keys:
        return []
    return [
        f"on_conflict ({', '.join(reference.conflict)}) matches no unique key of {reference.name}"
    ]


def _check_table(catalog: Catalog, reference: Reference) -> list[str]:
    key = (reference.schema, reference.name)
    if key not in catalog.columns:
        return [f"table {reference.schema}.{reference.name} does not exist"]
    missing = (reference.columns | set(reference.conflict)) - catalog.columns[key]
    problems = [
        f"column {reference.schema}.{reference.name}.{c} does not exist" for c in sorted(missing)
    ]
    problems += _check_embeds(catalog, reference.schema, reference.name, reference.embeds)
    problems += _rights(catalog, reference, catalog.tables[key])
    return problems + _check_conflict(catalog, reference)


def check_all(catalog: Catalog, references: list[Reference]) -> list[str]:
    """Every mismatch, one line each: location, call and what is wrong."""
    lines: list[str] = []
    for reference in references:
        check = _check_rpc if reference.kind == "rpc" else _check_table
        lines += [
            f"{reference.location} {reference.schema}.{reference.name}: {problem}"
            for problem in check(catalog, reference)
        ]
    return lines
