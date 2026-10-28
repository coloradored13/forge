# Forge

A product manager works a PRD into a vetted, linked backlog a team can take — or keeps going, and agents build the product with the pipeline producing the proof.

One repo, two halves, one seam. **Discovery** (`discovery/`) produces what humans sign. **Delivery** (`delivery/`) produces what machines prove. `shared/` is what both stand on, and nothing else. The PM chooses where to stop.

- [SPEC.md](SPEC.md) — the spec: evidence, the split, rules R1–R15, both halves, milestones, decisions.
- [PORT.md](PORT.md) — what crosses from v1 and when.
- `shared/rules.json` — the rule registry: one enforcer per rule.
- `npm run evals` — every gate, on seeded fixtures in temp roots, then the real tree.

## Run it

You need Node 22 or later, git with a name and email set, the GitHub CLI signed in (`gh auth login`), and Claude Code signed in, since the model calls run on its subscription. From this folder:

```
npm ci
npm run console -- ~/Forge/my-product
```

Open the URL it prints. Set up the project, which creates the folder and a private GitHub repo. Then open the PRD with your idea, and the workshop asks its first question.

The project folder can be anywhere outside this checkout. The console stays at http://127.0.0.1:4747 unless `PORT` says otherwise.

Status: **M0** — spec approved, repo seeded. v1 is [Dev-Team](https://github.com/coloradored13/Dev-Team), archived as the evidence corpus.
