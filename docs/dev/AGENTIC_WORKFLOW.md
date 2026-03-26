# Our Agentic Workflow

Inspired by Stripe's Minions architecture. This doc captures what we learned and how we apply it to our projects.

**Related:** [[Stripe Minions - One-Shot Coding Agents]]

---

## What We Learned from Stripe

### The Core Insight: Blueprints
Stripe mixes **deterministic steps** (always run, no LLM) with **agentic steps** (LLM with wide latitude) in a structured flow. The reliable, predictable steps are locked in code — the creative steps get the model.

Example blueprint:
```
Gather context → [Agent] Implement task → [Det.] Run linters → [Agent] Fix errors → [Det.] Push → [Det.] Run tests → PR
```

### Key Principles We're Adopting

| Principle | What It Means for Us |
|---|---|
| **Spec first** | Write Obsidian notes before spawning any agent |
| **AGENTS.md per repo** | Every project gets a rule file read by all agents |
| **Blueprint-style prompts** | Structure sub-agent tasks as explicit ordered steps |
| **Isolated agents** | Fresh context per task — never reuse messy sessions |
| **Shift feedback left** | Pre-commit hooks catch issues before they hit CI/Vercel |
| **Constrained scope** | Tell agents exactly which files/dirs they can touch |
| **Human review stays** | Agents write, Jesse reviews — always |

### What We Skip (Stripe-Specific)
- Subdirectory AGENTS.md files — our codebases are small enough that one root file per repo is plenty
- Devboxes / cloud environments — local dev is fine at our scale
- MCP Toolshed — not needed yet; tools are simple enough to describe in AGENTS.md

---

## Our Workflow in Practice

### Starting a New Feature
1. **Write a spec in Obsidian** — user story, decisions, open questions answered
2. **Reference AGENTS.md** — make sure it's current before spawning an agent
3. **Spawn a sub-agent** with a blueprint-style prompt (see below)
4. **Review the output** — Jesse reviews, merges if good
5. **Never push to main** without explicit instruction

### Blueprint-Style Sub-Agent Prompts
Structure agent tasks with explicit steps, marking deterministic vs. agentic:

```
Read AGENTS.md first.

Steps:
1. [READ] Read src/routes/+page.svelte to understand current structure
2. [AGENT] Implement [feature] in src/routes/[path]/
3. [DET] Run: pnpm svelte-check — fix any type errors before continuing
4. [DET] Run: pnpm biome check src/ — fix any lint errors
5. [REPORT] Summarize what you changed and any decisions made

Constraints:
- Only edit files in src/routes/[path]/ and src/lib/components/
- Do NOT push to git
- Do NOT modify package.json or config files
```

### Pre-Commit Hooks (Live on all repos)
Every project has husky + lint-staged:
- **SvelteKit projects:** Biome (JS/TS) + svelte-check (Svelte)
- **Sanity studio:** ESLint (JS/TS)
- Commit blocked if checks fail — catches issues before Vercel

---

## Project Registry

| Project | Stack | Linter | Git Remote | Status |
|---|---|---|---|---|
| angelsrest | SvelteKit + Skeleton + Sanity + Stripe | Biome + svelte-check | GitHub ✅ | Live (angelsrest.online) |
| angelsrest-studio | Sanity Studio v3 | ESLint | GitHub ✅ | Live |
| fotoflo | SvelteKit + neo-svelte + PWA | svelte-check + Biome | GitHub ✅ | In progress |
| bloomflow | SvelteKit + Skeleton + Jazz Tools | svelte-check + Biome | No remote | In progress |
| lifedash | SvelteKit + Skeleton | svelte-check + Biome | GitHub ✅ | Early |
| aic-palette-gen | SvelteKit + node-vibrant + Neon | svelte-check | No remote | Planning |

---

## Spec Template (for new features)

```markdown
## Feature: [Name]

### User Story
As a [user], I want to [goal], so that [benefit].

### Decisions
| Question | Answer |
|---|---|

### Blueprint
1. [READ] ...
2. [AGENT] ...
3. [DET] Run checks
4. [REPORT] ...

### Constraints
- Files in scope: ...
- Files out of scope: ...
- Do NOT: ...
```

---

## Session Compaction Reminders

After finishing a project chunk (merge to main, completing a feature, or wrapping up a significant session), it's easy to forget to document what you learned. Two low-friction solutions:

### 1. Post-Merge Git Hook
Create `.git/hooks/post-merge` in any repo:

```bash
#!/bin/bash
echo "🔔 Session complete — consider documenting what you learned before starting something new"
echo "   - What did you work on?"
echo "   - What did you learn?"
echo "   - Any context to capture?"
```

Make executable: `chmod +x .git/hooks/post-merge`

This fires after every `git merge` or `git pull`.

### 2. Obsidian Session Debrief Template
A quick 3-question template for end-of-session capture. Create a link or use a launcher (Raycast, KeyboardMaestro):

- **What did I work on?**
- **What did I learn?**
- **What needs capturing?**

Keeps the reflection tiny but consistent. Beats losing context to the void.

---

*Last updated: 2026-03-26*
