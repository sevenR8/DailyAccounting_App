# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- Relevant decisions in `docs/adr/`.

If they do not exist, proceed silently. The domain-modeling workflow creates them when terms or decisions are resolved.

## File structure

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use the terms defined in `CONTEXT.md` in issues, designs, test names, and implementation notes. If a required concept is absent, record the gap for the domain-modeling workflow rather than silently introducing a synonym.

## Flag ADR conflicts

Surface any conflict with an existing ADR explicitly instead of silently overriding it.

