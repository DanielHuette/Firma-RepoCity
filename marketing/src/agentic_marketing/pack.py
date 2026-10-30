"""Assembling the context pack an agent session starts with.

Context: A session that re-explains the company every time burns its budget on what it
already knows. The pack is a fixed, measured set of base files, and a pack that outgrows
its budget is an error rather than a slow surprise months later. | Input: a workspace. |
Output: the concatenated pack and its size.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from agentic_marketing.errors import BudgetExceededError, WorkspaceError
from agentic_marketing.models import ContextPack, PackedFile
from agentic_marketing.text import estimate_tokens
from agentic_marketing.workspace import BASE_FILES


def build_pack(root: Path, *, budget: int, extra: Sequence[str] = ()) -> tuple[str, ContextPack]:
    """Concatenate the base files of a workspace into one context pack.

    Args:
        root: Workspace root.
        budget: Upper bound in tokens.
        extra: Workspace-relative paths to append to the base files.

    Returns:
        The pack as text, and its measurement.

    Raises:
        WorkspaceError: If a base file or a named extra file is missing.
        BudgetExceededError: If the pack is larger than the budget.
    """
    wanted = [*BASE_FILES, *extra]
    missing = [name for name in wanted if not (root / name).is_file()]
    if missing:
        raise WorkspaceError(f"the pack cannot be built, these files are missing: {missing}")
    blocks: list[str] = []
    packed: list[PackedFile] = []
    for name in wanted:
        text = (root / name).read_text(encoding="utf-8")
        blocks.append(f"<!-- {name} -->\n{text.strip()}\n")
        packed.append(PackedFile(path=name, chars=len(text), tokens=estimate_tokens(text)))
    pack = ContextPack(files=packed, budget=budget)
    if not pack.within_budget:
        raise BudgetExceededError(
            f"the pack is {pack.tokens} tokens, the budget is {budget}; "
            "shorten a curated file rather than raising the budget"
        )
    return "\n".join(blocks), pack
