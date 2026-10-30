---
name: amm-zielgruppe
description: Build the audience description the whole workspace references - who buys, in what role, with what words. Use once per product, and again when the offer changes.
---

# Audience

Everything written for a channel eventually references this file. It is worth getting
slow and right.

Write into a run folder as `.claude/run-format.md` describes, lens `audience`. For a
product-specific audience, put the run under `produkte/<product>/zielgruppe/`.

## The shape

- **Who decides** Role, company size, what they are measured on.
- **Who uses** Often a different person. What their day looks like.
- **The problem in their words** Taken from review mining, support tickets or sales call
  transcripts. Never invented, never smoothed.
- **What they have tried** Including the in-house spreadsheet. Whatever they tried is
  what your offer is compared against.
- **What disqualifies** Who should not buy. An audience description without this is a
  wish list.

## Evidence over persona

A persona with a stock photo and a first name is a guess with a face on it. Every
statement here needs a source: an export, a transcript, a counted set of reviews.

Where the only honest answer is "we do not know", write that as a gap in `inbox/` rather
than as a finding. A gap someone can go and close beats a plausible sentence nobody can
check.

## Finishing

The curated file is written by `agentic-marketing apply`. Report to `inbox/`.
