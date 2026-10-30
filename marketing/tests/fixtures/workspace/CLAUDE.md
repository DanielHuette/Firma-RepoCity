# Marketing workspace

Everything here is a plain Markdown file. Agents read and write these files; no state
lives anywhere else.

## Where things belong

| Folder | Holds | Changes |
|---|---|---|
| `stammdaten/` | who the person and the company are | rarely |
| `strategie/` | positioning, audience, goals, environment analyses, marketing mix | rarely |
| `produkte/<product>/` | offer, competitors, case studies, audience per product | rarely |
| `kanaele/<channel>/` | what is planned, drafted and published per channel | daily |
| `kampagnen/<campaign>/` | one campaign from brief to result | per campaign |
| `projekte/<project>/` | recurring work that is not a channel | ongoing |
| `daten/` | raw exports, and source files analyses are checked against | ongoing |
| `inbox/` | finished output waiting for a human decision | constantly |
| `tools/` | connector notes and tool configuration, never credentials | rarely |

Needing a new top-level folder is almost always a sign that something was filed in the
wrong place.

## How an analysis becomes context

An analysis never writes its result straight into the workspace.

1. The agent team works inside a dated run folder below its lens, for example
   `strategie/umwelt/makroanalyse/makroanalyse-2026-08-29/`, and writes one file per
   finding in the format described in `.claude/run-format.md`.
2. `agentic-marketing verify <run>` checks every figure against the source it names.
   `--model` adds a second pass that judges whether the source carries the statement.
3. `agentic-marketing review <run>` builds the page a human decides on.
4. `agentic-marketing apply <run>` writes the curated file one level up and reports how
   much survived.

Only the curated file is ever loaded again. The run folder stays where it is.

## Rules for every agent

- Load context with `/prime`. Do not walk the workspace folder by folder.
- Never state a figure without the source it came from.
- What a curated file does not contain counts as unchecked. Do not fill the gap.
- Before producing anything for a channel, read that channel's folder. If the subject is
  already covered there, say so instead of producing a second version.
- Write results to `inbox/`, never straight into a channel folder. A person decides.
- Follow the cost rules in `.claude/rules.md`.
