---
name: amm-porters-five
description: Five forces - how much of the margin in this market is taken by rivals, buyers, suppliers, substitutes and newcomers. Use when deciding whether a market is worth entering or defending.
---

# Five forces

Write into a run folder as `.claude/run-format.md` describes, lens `porters-five`.

## The five

1. **Rivalry** How many providers, how similar, how fast they undercut each other.
2. **Buyer power** How easily a customer switches, and how much of the revenue sits with
   how few customers.
3. **Supplier power** What the company depends on that it cannot replace quickly. For a
   software company this includes the model vendor and the platform it distributes on.
4. **Substitutes** The other ways the need gets met, including not meeting it.
5. **New entrants** What it costs to start, and whether that cost is falling.

## How to make it more than a seminar exercise

Each force needs at least one finding with a number attached. "Buyer power is high"
without a figure is an opinion with a diagram around it.

Usable figures: concentration of revenue across customers, switching cost in time or
money, length of contract, share of input cost from one supplier, number of providers
that entered the market in the last two years.

State for each force whether it is rising or falling and since when, with
`horizon: forecast` and the reasoning in the detail. A static force table is a snapshot
of a market that is moving.

## Finishing

The curated file is written by `agentic-marketing apply`. Report to `inbox/`.
