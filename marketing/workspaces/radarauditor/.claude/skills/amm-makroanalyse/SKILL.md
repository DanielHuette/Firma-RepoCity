---
name: amm-makroanalyse
description: STEP analysis of the environment nobody controls. Use when the strategy needs the outside picture - before positioning, before a yearly plan, or when the market feels different and nobody can say why.
---

# Macro analysis (STEP)

The environment that applies to every provider in the market equally and that none of
them can change. Four fields: sociocultural, technological, economic, political-legal.

Write into a run folder exactly as `.claude/run-format.md` describes, lens `macro-step`.

## Method

For each of the four fields, separate two things and mark them with `horizon`:

- **Current** (`horizon: current`): what is measurably true today. A figure, a date, a
  source. No adjectives.
- **Forecast** (`horizon: forecast`): what follows from it, dated. "By 2031, X" with the
  reasoning in the detail. A forecast without a current finding under it is guesswork.

Aim for four forecasts and eight current findings per field. Fewer is fine. Padding to
hit the number is not.

## What makes a finding usable

A macro finding earns its place when it would change a marketing decision. "The
population is ageing" changes nothing. "45,8 percent of the people who sign off are 56
or older" changes which channel you buy.

So for every finding, write one sentence in the detail that says what it means for this
company specifically. If that sentence cannot be written, drop the finding.

## Sources

Official statistics, industry bodies, regulators, annual reports, trade press. Download
what you cite into `daten/quellen/` and reference it as a local source. An address that
resolves today may not in a year; a file in the workspace still will.

Never carry a figure over from a summary, a chart caption or another analysis. Open the
source that first published it.

## Finishing

Do not write the result into `strategie/umwelt/makroanalyse/makro-analyse.md`. That file
is written by `agentic-marketing apply` after a person has gone through the findings.
Report in `inbox/` that the run is ready to review.
