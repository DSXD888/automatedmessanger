# Dentino SMS Reminder — Planmaxer Archive Prompt (Iteration 1)

**Date:** 2026-06-17
**Purpose:** After the iteration-1 cycle is complete (all four reviews integrated + the holistic pass run), archive this iteration's working artifacts and reset `active/` for iteration 2.

> Run this **last**, only once you've finished integrating all four domain reviews and completed `holistic-pass.md`. It **moves** (never deletes) the current artifacts into a dated archive and bumps the iteration counter. Per AGENTS.md RULE 1, do not delete any files — these are `mv`/`git mv` moves only.

---

~~~
First read AGENTS.md (RULE 1: never delete a file without permission — this task only MOVES files, never deletes content). The planmaxer root for this project is `docs/planmaxer/`.

Goal: archive iteration 1's artifacts and prepare for iteration 2.

1. READ the current iteration number:
   - cat docs/planmaxer/.iteration   → it should read `1`.
   - (If the file is missing, treat the current iteration as 0; but here it is 1.)
   - Let NNN = that number, zero-padded to 3 digits → `001`.

2. CREATE the archive directory:
   - mkdir -p docs/planmaxer/archived/iteration-001/handoffs
   - mkdir -p docs/planmaxer/archived/iteration-001/prepreps
   - mkdir -p docs/planmaxer/archived/iteration-001/reviews

3. MOVE all of active/'s contents into the archive (use `git mv` so history is preserved; fall back to `mv` for any untracked file):
   - git mv docs/planmaxer/active/handoffs/*  docs/planmaxer/archived/iteration-001/handoffs/
   - git mv docs/planmaxer/active/prepreps/* docs/planmaxer/archived/iteration-001/prepreps/
   - If docs/planmaxer/active/reviews/ has any saved reviewer responses:
       git mv docs/planmaxer/active/reviews/*    docs/planmaxer/archived/iteration-001/reviews/
   - git mv docs/planmaxer/active/holistic-pass.md docs/planmaxer/archived/iteration-001/holistic-pass.md
   - git mv docs/planmaxer/active/archive.md       docs/planmaxer/archived/iteration-001/archive.md
   (If a `git mv` errors because a file is untracked, redo just that one with plain `mv`.)

4. RECREATE the empty active/ subdirectories so the next /planmaxer run has somewhere to write:
   - mkdir -p docs/planmaxer/active/handoffs docs/planmaxer/active/prepreps docs/planmaxer/active/reviews

5. INCREMENT the iteration counter:
   - Write `2` to docs/planmaxer/.iteration (current 1 + 1).

6. REPORT:
   - How many handoffs, prepreps, and reviews were archived.
   - The new iteration number (2).
   - Confirm active/ is empty and the counter reads 2.
   - Reminder: "Run /planmaxer to generate fresh artifacts for iteration 2 — it will read the updated (post-iteration-1) research doc and detect the new tension/precision frontier."

7. (Optional, per AGENTS.md session protocol) Commit the archive move:
   - git add docs/planmaxer/ && git commit (do NOT push unless asked).

Use ultrathink. Move, never delete.
~~~
