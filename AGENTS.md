## Agent skills

### Issue tracker

Local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.


## Coding standards

- No Client side javascript is allowed.
- Forms should use Astro Actions. 
- Each page needs to specify which sites can be pre-fetched immdiately. 
- CSS-only UI with DaisyUI and Tailwind. Reach for the DaisyUI skill. Never reach for JS-dependent components.