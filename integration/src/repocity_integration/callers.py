"""Every database call of every RepoCity part, read from source, ready to check against the catalog.

Context: Who calls what, as which role: the CRM, Cockpit and RadarAuditor apps as the signed-in
administrator, the Cockpit service worker without sign-in, the Edge Functions crm-mail,
crm-calendar, crm-abmelden, crm-termin and cockpit-push and the RadarAuditor worker with the service
key. | Input: the repository folder. | Output: CALLERS and references(), the list of Reference
values of all of them.
"""

import ast
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from repocity_integration.references import Reference
from repocity_integration.scan_py import Module, model_fields, python_references
from repocity_integration.scan_ts import (
    TsFile,
    helper_references,
    raw_rpc_references,
    supabase_references,
)
from repocity_integration.tsparse import TypeIndex, constants_of

_RADAR_DB = "radarauditor/src/radarauditor/db"


@dataclass(frozen=True)
class Caller:
    """One part of RepoCity: its sources, how it reaches the database and as whom."""

    folder: str
    style: str
    schema: str
    role: str


CALLERS = (
    Caller("crm/app/src", "supabase-js", "crm", "authenticated"),
    Caller("cockpit/app/src", "supabase-js", "cockpit", "authenticated"),
    Caller("radarauditor/app/src", "supabase-js", "public", "authenticated"),
    Caller("cockpit/app/sw", "rest", "cockpit", "anon"),
    Caller("crm/supabase/functions/crm-mail", "rest", "crm", "service_role"),
    Caller("crm/supabase/functions/crm-calendar", "rest", "crm", "service_role"),
    Caller("crm/supabase/functions/crm-abmelden", "rest", "crm", "service_role"),
    Caller("crm/supabase/functions/crm-termin", "rest", "crm", "service_role"),
    Caller("cockpit/supabase/functions/cockpit-push", "rest", "cockpit", "service_role"),
    Caller(_RADAR_DB, "supabase-py", "public", "service_role"),
)


def _is_source(path: Path) -> bool:
    name = path.name
    return (
        path.suffix in (".ts", ".tsx")
        and not name.endswith((".test.ts", ".test.tsx", "_test.ts"))
        and name != "rest.ts"
        and "testing" not in path.parts
    )


def _ts_files(repository: Path, caller: Caller) -> list[TsFile]:
    paths = sorted(p for p in (repository / caller.folder).rglob("*") if _is_source(p))
    texts = {path: path.read_text(encoding="utf-8") for path in paths}
    types = TypeIndex()
    for text in texts.values():
        types.add_source(text)
    folder_text = "\n".join(texts.values())
    return [
        TsFile(str(path.relative_to(repository)), text, constants_of(text), types, folder_text)
        for path, text in texts.items()
    ]


def _ts_references(repository: Path, caller: Caller) -> Iterator[Reference]:
    for file in _ts_files(repository, caller):
        if caller.style == "supabase-js":
            yield from supabase_references(file, caller.schema, caller.role)
            continue
        yield from helper_references(file, caller.schema, caller.role)
        # Edge Functions call /rpc/is_admin with the token they received, not with their own key.
        anonymous = caller.role == "anon"
        yield from raw_rpc_references(
            file,
            caller.schema if anonymous else "public",
            caller.role if anonymous else "authenticated",
        )


def _python_references(repository: Path) -> Iterator[Reference]:
    folder = repository / _RADAR_DB
    models = model_fields(
        [(folder / name).read_text(encoding="utf-8") for name in ("models.py", "crm.py")]
    )
    path = folder / "repositories.py"
    module = Module(
        str(path.relative_to(repository)),
        ast.parse(path.read_text(encoding="utf-8")),
        models,
    )
    yield from python_references(module)


def references(repository: Path) -> list[Reference]:
    """Every database call of every caller, sorted by location."""
    found: list[Reference] = []
    for caller in CALLERS:
        source = (
            _python_references(repository)
            if caller.style == "supabase-py"
            else _ts_references(repository, caller)
        )
        found.extend(source)
    return sorted(found, key=lambda r: (r.location.split(":")[0], int(r.location.split(":")[1])))
