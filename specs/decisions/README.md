# Architecture Decision Records

Decision records preserve the reason behind choices so later work does not reopen them accidentally.

## When to add a record

Add or replace a record when a change affects one or more of these areas:

- Product scope or non-goals.
- Component boundaries or trust boundaries.
- Browser permissions.
- Native-messaging protocol or storage format.
- Provider/authentication model.
- Runtime framework or significant dependency.
- Supported or blocked sites.
- Sensitive-data handling.
- Compatibility or distribution commitments.

Small implementation details that remain inside an existing boundary do not need a record.

## Status values

- `Proposed`: under consideration and not binding.
- `Accepted`: current direction and binding on implementation.
- `Superseded`: replaced by a newer record; link to its replacement.
- `Rejected`: considered and intentionally not chosen.

## Record template

```markdown
# NNNN: Short decision title

- Status: Proposed | Accepted | Superseded | Rejected
- Date: YYYY-MM-DD
- Supersedes: None | ADR link

## Context

What problem or constraint requires a decision?

## Decision

What are we doing?

## Alternatives considered

What credible alternatives were evaluated?

## Consequences

What becomes easier, harder, required, or prohibited?

## Revisit when

What concrete change would justify reconsidering this decision?
```

Do not edit the meaning of an accepted historical record. Add a superseding record instead.
