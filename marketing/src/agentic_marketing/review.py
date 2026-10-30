"""The human gate between a research run and the workspace.

Context: The reviewer sees every finding with its verdict and keeps or drops it. The page
is only the surface; what counts is that each decision lands in a file on disk, so the
curated file can be rebuilt from the run and that file alone. | Input: findings and
verifications. | Output: a review page, and decisions read back from disk.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from agentic_marketing.errors import DecisionError
from agentic_marketing.models import Decision, Finding, Verification

DECISIONS_NAME = "decisions.json"
PAGE_NAME = "review.html"

_STYLE = """
:root{--bg:#fbfaf8;--fg:#1b1a17;--muted:#6b665d;--line:#e2ddd3;--card:#fff;
--keep:#1f6f4a;--drop:#8c2f2f;--warn:#9a6212;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#15150f;--fg:#ece7dc;
--muted:#9a948a;--line:#2f2d26;--card:#1d1c16;--keep:#5fbf8e;--drop:#e08a8a;--warn:#d6a44b}}
:root[data-theme=dark]{--bg:#15150f;--fg:#ece7dc;--muted:#9a948a;--line:#2f2d26;--card:#1d1c16;
--keep:#5fbf8e;--drop:#e08a8a;--warn:#d6a44b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:32px 16px 96px}
h1{font-size:1.5rem;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 28px;font-size:.92rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;
padding:18px;margin:0 0 14px}
.card.kept{border-left:4px solid var(--keep)}
.card.dropped{border-left:4px solid var(--drop);opacity:.55}
.stmt{font-weight:600;margin:0 0 8px}.detail{margin:0 0 12px}
.meta{font:12px/1.5 var(--mono);color:var(--muted);word-break:break-word}
.badge{display:inline-block;font:11px/1 var(--mono);text-transform:uppercase;letter-spacing:.06em;
padding:5px 8px;border-radius:999px;border:1px solid var(--line);margin-right:6px}
.b-supported{color:var(--keep)}.b-partial{color:var(--warn)}
.b-unsupported,.b-unreachable{color:var(--drop)}.b-not-checked{color:var(--muted)}
.row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
button{font:inherit;padding:7px 14px;border-radius:7px;border:1px solid var(--line);
background:transparent;color:var(--fg);cursor:pointer}
button.on{border-color:currentColor;font-weight:600}
button.k.on{color:var(--keep)}button.d.on{color:var(--drop)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);
padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.bar b{font:13px/1 var(--mono)}
.hint{font-size:.85rem;color:var(--muted);text-align:center;margin-top:10px}
@media(max-width:560px){.wrap{padding:20px 16px 120px}}
"""

_SCRIPT = """
const state = new Map();
function paint(id){
  const card = document.getElementById('c-'+id);
  const v = state.get(id);
  card.className = 'card' + (v===true?' kept':v===false?' dropped':'');
  card.querySelector('.k').classList.toggle('on', v===true);
  card.querySelector('.d').classList.toggle('on', v===false);
  const open = DATA.findings.filter(f=>!state.has(f.id)).length;
  document.getElementById('count').textContent =
    [...state.values()].filter(Boolean).length + ' kept, ' +
    [...state.values()].filter(v=>v===false).length + ' dropped, ' + open + ' open';
}
function set(id, keep){ state.set(id, keep); paint(id); }
function save(){
  const today = new Date().toISOString().slice(0,10);
  const payload = { run_id: DATA.run_id, decisions: [...state].map(([finding_id, keep]) =>
    ({ finding_id, keep, note: null, decided: today })) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = DATA.decisions_name; a.click();
  URL.revokeObjectURL(a.href);
}
DATA.findings.forEach(f => paint(f.id));
"""


def _escape(value: str) -> str:
    """Make a string safe to drop into HTML text."""
    return (
        value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def _card(finding: Finding, verification: Verification | None) -> str:
    """Render one finding as a review card."""
    verdict = verification.verdict.value if verification else "not-checked"
    stage = verification.stage.value if verification else "-"
    bits = [f'<span class="badge b-{verdict}">{verdict}</span>']
    bits.append(f'<span class="badge">pass: {stage}</span>')
    if verification and verification.figures_missing:
        missing = ", ".join(verification.figures_missing)
        bits.append(f'<span class="badge b-unsupported">missing: {_escape(missing)}</span>')
    meta = [f"Source: {_escape(finding.source.citation())}"]
    if verification and verification.evidence:
        meta.append(f"Evidence: {_escape(verification.evidence)}")
    if verification and verification.note:
        meta.append(f"Note: {_escape(verification.note)}")
    return (
        f'<article class="card" id="c-{_escape(finding.id)}">'
        f"<div>{''.join(bits)}</div>"
        f'<p class="stmt">{_escape(finding.statement)}</p>'
        f'<p class="detail">{_escape(finding.detail)}</p>'
        f'<div class="meta">{"<br>".join(meta)}</div>'
        f'<div class="row">'
        f'<button class="k" onclick="set(\'{_escape(finding.id)}\',true)">Keep</button>'
        f'<button class="d" onclick="set(\'{_escape(finding.id)}\',false)">Drop</button>'
        f"</div></article>"
    )


def build_page(
    findings: Sequence[Finding],
    verifications: Sequence[Verification],
    *,
    run_id: str,
    decisions_path: Path,
) -> str:
    """Render the review page for one run.

    Args:
        findings: Findings of the run, in reading order.
        verifications: Their verdicts, matched by finding id.
        run_id: Folder name of the run, written into the saved decisions.
        decisions_path: Where the page tells the reviewer to save the file.

    Returns:
        A self-contained HTML page that loads nothing from the network.
    """
    by_id = {item.finding_id: item for item in verifications}
    cards = "\n".join(_card(finding, by_id.get(finding.id)) for finding in findings)
    data: dict[str, Any] = {
        "run_id": run_id,
        "decisions_name": DECISIONS_NAME,
        "findings": [{"id": finding.id} for finding in findings],
    }
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>Review {_escape(run_id)}</title><style>{_STYLE}</style></head><body>"
        f'<div class="wrap"><h1>{_escape(run_id)}</h1>'
        f'<p class="sub">{len(findings)} findings. Keep what you can stand behind. '
        "What you drop stays in the run folder and never enters the workspace.</p>"
        f"{cards}</div>"
        f'<div class="bar"><b id="count"></b>'
        '<button onclick="save()">Save decisions</button></div>'
        f'<p class="hint">Save the file as {_escape(str(decisions_path))}, '
        "then run <code>agentic-marketing apply</code>.</p>"
        f"<script>const DATA={json.dumps(data)};{_SCRIPT}</script></body></html>"
    )


def write_page(page: str, target: Path) -> Path:
    """Write the review page next to its run.

    Args:
        page: The rendered page.
        target: File to write.

    Returns:
        The path written.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(page, encoding="utf-8")
    temporary.replace(target)
    return target


def read_decisions(path: Path, *, run_id: str) -> list[Decision]:
    """Read the decisions the reviewer saved.

    Args:
        path: The decisions file.
        run_id: The run the decisions must belong to.

    Returns:
        One decision per finding the reviewer ruled on.

    Raises:
        DecisionError: If the file is missing, malformed or belongs to another run.
    """
    if not path.is_file():
        raise DecisionError(f"{path} does not exist; save the decisions from the review page first")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise DecisionError(f"{path} cannot be read: {error}") from error
    if not isinstance(payload, dict):
        raise DecisionError(f"{path} is not a decisions file")
    if payload.get("run_id") != run_id:
        raise DecisionError(f"{path} belongs to run {payload.get('run_id')!r}, not {run_id!r}")
    raw = payload.get("decisions")
    if not isinstance(raw, list):
        raise DecisionError(f"{path} carries no decisions list")
    try:
        return [Decision(**entry) for entry in raw]
    except (ValidationError, TypeError) as error:
        raise DecisionError(f"{path}: {error}") from error


def write_decisions(decisions: Sequence[Decision], target: Path, *, run_id: str) -> Path:
    """Write a decisions file, for use without a browser.

    Args:
        decisions: The decisions to record.
        target: File to write.
        run_id: The run the decisions belong to.

    Returns:
        The path written.
    """
    payload = {
        "run_id": run_id,
        "decisions": [json.loads(decision.model_dump_json()) for decision in decisions],
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    return target


def keep_supported(
    findings: Sequence[Finding], verifications: Sequence[Verification], *, today: date | None = None
) -> list[Decision]:
    """Decisions that keep everything the checks support, for an unattended run.

    This is the fallback for a scheduled run where nobody is at the page. It keeps what
    held up and drops the rest, which is a defensible default but not a human judgement.

    Args:
        findings: Findings of the run.
        verifications: Their verdicts.
        today: Decision date; today when omitted.

    Returns:
        One decision per finding.
    """
    decided = today or date.today()
    by_id = {item.finding_id: item for item in verifications}
    return [
        Decision(
            finding_id=finding.id,
            keep=bool(by_id.get(finding.id) and by_id[finding.id].keepable),
            note="kept by verdict, not by a person",
            decided=decided,
        )
        for finding in findings
    ]


def pending(findings: Sequence[Finding], decisions: Sequence[Decision]) -> list[str]:
    """Ids of findings nobody has ruled on yet."""
    ruled = {decision.finding_id for decision in decisions}
    return [finding.id for finding in findings if finding.id not in ruled]
