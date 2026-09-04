# Forge

A product manager works a PRD into a vetted, linked backlog a team can take — or keeps going, and agents build the product with the pipeline producing the proof.

One repo, two halves, one seam. **Discovery** (`discovery/`) produces what humans sign. **Delivery** (`delivery/`) produces what machines prove. `shared/` is what both stand on, and nothing else. The PM chooses where to stop.

- [SPEC.md](SPEC.md) — the spec: evidence, the split, rules R1–R15, both halves, milestones, decisions.
- [PORT.md](PORT.md) — what crosses from v1 and when.
- `shared/rules.json` — the rule registry: one enforcer per rule.
- `npm run evals` — every gate, on seeded fixtures in temp roots, then the real tree.

Status: **M0** — spec approved, repo seeded. v1 is [Dev-Team](https://github.com/coloradored13/Dev-Team), archived as the evidence corpus.
