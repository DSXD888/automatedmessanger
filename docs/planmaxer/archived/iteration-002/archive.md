# Archive Prompt — iteration 2

Run **after** both prepreps + the holistic pass are integrated and committed.

1. Read the current iteration number from `docs/planmaxer/.iteration` (currently `2`).
2. Create `docs/planmaxer/archived/iteration-002/` with subdirs `handoffs/`, `prepreps/`, `reviews/`.
3. Move all of `docs/planmaxer/active/` into it:
   - `active/handoffs/*`  → `archived/iteration-002/handoffs/`
   - `active/prepreps/*`  → `archived/iteration-002/prepreps/`
   - `active/reviews/*`   → `archived/iteration-002/reviews/`
   - `active/holistic-pass.md` → `archived/iteration-002/holistic-pass.md`
   - `active/archive.md`  → `archived/iteration-002/archive.md`
   (Use `git mv` so history is preserved; **never delete** files — AGENTS.md RULE 1.)
4. Recreate empty `active/handoffs/`, `active/prepreps/`, `active/reviews/`.
5. Write `3` to `docs/planmaxer/.iteration`.
6. Report: counts of handoffs/prepreps/reviews archived; new iteration number = 3; reminder: "Run `/planmaxer` to generate iteration-3 artifacts (or proceed to `/research-to-spec` if the plan is optimal)."
