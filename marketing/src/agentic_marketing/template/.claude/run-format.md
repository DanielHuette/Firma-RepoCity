# Run format

Every analysis writes into one dated folder below its lens:

```
<lens-home>/<lens>-<YYYY-MM-DD>/
├── run.yaml
├── findings/
│   ├── 001-<slug>.md
│   └── 002-<slug>.md
└── raw/
```

`raw/` holds whatever prose, tables and downloads the work produced. Nothing reads it
again; it exists so a finding can be traced back and so the compression figure is honest.

## run.yaml

```yaml
run_id: makroanalyse-2026-08-29
lens: macro-step
subject: Kanzleikollege
produced: 2026-08-29
```

`lens` is one of: `macro-step`, `micro`, `competitor`, `porters-five`, `reviews`,
`audience`.

## One finding per file

```markdown
---
id: macro-step/berufstraeger-alter
lens: macro-step
field: sociocultural
horizon: current
volatility: structural
figures: ["45,8", "90.336", "53,7"]
source:
  kind: local
  publisher: BStBK
  title: Berufsstatistik 2025
  path: daten/quellen/bstbk-berufsstatistik-2025.txt
  published: 2026-04-23
  retrieved: 2026-08-29
  locator: Seite 12
---

# 45,8 Prozent der Berufsträger sind 56 Jahre oder älter

Von 90.336 Berufsangehörigen sind 45,8 Prozent 56 Jahre oder älter und 20,6 Prozent unter
40. Das Durchschnittsalter liegt bei 53,7 Jahren.
```

Rules the tooling enforces, so a run that breaks them fails instead of passing quietly:

- `id` is `<lens>/<slug>` and unique within the run.
- `field` is set for `macro-step` and for nothing else. One of `sociocultural`,
  `technological`, `economic`, `political-legal`.
- `horizon` is `current` or `forecast`.
- `volatility` is `price` (re-check after 90 days), `market` (365 days) or `structural`
  (never on its own).
- `figures` lists every number the statement rests on, spelled as the source spells it.
  A statement with no number is allowed and gets checked by the model pass instead.
- `source.kind` is `web`, `pdf`, `local` or `internal`. `web` and `pdf` need `url`,
  `local` needs a workspace-relative `path`.
- The `# ` line is the statement and must be a sentence, not a heading.
- Everything below it is the detail.

Download a source you will cite into `daten/quellen/` and point at it with
`kind: local`. A check against a file that is still there in six months is worth more
than one against an address that has moved.
