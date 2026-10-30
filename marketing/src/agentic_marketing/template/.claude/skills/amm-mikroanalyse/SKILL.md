---
name: amm-mikroanalyse
description: Micro analysis of market, customers and buying behaviour - the part of the environment this company sits inside and partly shapes. Use after the macro analysis, or when the audience is unclear.
---

# Micro analysis

Where the macro analysis looks at what nobody controls, this looks at the market this
company is actually in: its size, its customers, how they buy, and who else is in it.

Write into a run folder as `.claude/run-format.md` describes, lens `micro`.

## The five questions

1. **Market** How large, growing or shrinking, and by what measure? Give the figure and
   the body that published it.
2. **Customers** Who buys, in what role, with what budget? Separate the person who uses
   from the person who signs.
3. **Buying behaviour** What triggers the purchase, how long does it take, who else is
   consulted, what stops it?
4. **Competitors** Who else answers the same need, including the answers that are not
   products (doing nothing, doing it in-house, a spreadsheet).
5. **Suppliers and intermediaries** Who stands between this company and its market, and
   what do they cost?

## Where the figures come from

Industry associations, market research that names its method, company filings, and the
company's own exports in `daten/`. The company's own numbers are the most valuable and
the most often forgotten: order values, win and loss rates, contract durations, support
tickets.

An internal figure is a source too. Record it with `kind: local` and the path of the
export, so the check can open it.

## Finishing

The curated file is written by `agentic-marketing apply`. Report to `inbox/`.
