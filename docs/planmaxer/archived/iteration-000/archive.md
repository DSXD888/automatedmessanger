# Dentino SMS Reminder — Planmaxer Iteration Archive Prompt

**Date:** 2026-06-17
**Purpose:** Run this AFTER you've finished the current iteration — all handoffs sent, reviewer responses integrated via the pre-preps, and the holistic pass applied. It moves `docs/planmaxer/active/` into a numbered archive and resets `active/` for the next `/planmaxer` run.

> Paths below are relative to the project root `/Users/dieterdanicek/Desktop/automatedmessanger`.
> The planmaxer root for this project is **`docs/planmaxer/`** (it lives under `docs/` to match `docs/harmonymaxer/`).

---

~~~
Do the following exactly, in order. Use shell commands; report what happened at the end.

1. READ the current iteration number from docs/planmaxer/.iteration
   - If the file doesn't exist, treat the current iteration as 0.
   - Call this number N.

2. CREATE the archive directory:
   docs/planmaxer/archived/iteration-{NNN}/        (NNN = N zero-padded to 3 digits, e.g. 000)

3. MOVE all current-iteration artifacts into it:
   docs/planmaxer/active/handoffs/        → docs/planmaxer/archived/iteration-{NNN}/handoffs/
   docs/planmaxer/active/prepreps/        → docs/planmaxer/archived/iteration-{NNN}/prepreps/
   docs/planmaxer/active/reviews/         → docs/planmaxer/archived/iteration-{NNN}/reviews/   (may be empty — reviewers here are external chat models, so saved reviews are optional)
   docs/planmaxer/active/holistic-pass.md → docs/planmaxer/archived/iteration-{NNN}/holistic-pass.md
   docs/planmaxer/active/archive.md        → docs/planmaxer/archived/iteration-{NNN}/archive.md

4. RECREATE empty active/ subdirectories:
   docs/planmaxer/active/handoffs/
   docs/planmaxer/active/prepreps/
   docs/planmaxer/active/reviews/

5. INCREMENT the counter:
   write (N + 1) to docs/planmaxer/.iteration

6. REPORT:
   - how many handoffs, prepreps, and reviews were archived
   - the archive path (docs/planmaxer/archived/iteration-{NNN}/)
   - the new iteration number (N + 1)
   - reminder: "Re-run /planmaxer to generate fresh artifacts for iteration {N+1} against the now-updated
     research doc — each iteration reads the current plan state fresh and targets whatever tensions remain."
~~~

---

### Suggested one-shot (verify the paths before running)

```bash
cd /Users/dieterdanicek/Desktop/automatedmessanger/docs/planmaxer
N=$(cat .iteration 2>/dev/null || echo 0)
NNN=$(printf '%03d' "$N")
dest="archived/iteration-$NNN"
mkdir -p "$dest"
# move artifacts (ignore any that don't exist)
for item in active/handoffs active/prepreps active/reviews active/holistic-pass.md active/archive.md; do
  [ -e "$item" ] && mv "$item" "$dest/"
done
mkdir -p active/handoffs active/prepreps active/reviews
printf '%s' "$((N + 1))" > .iteration
echo "Archived iteration $NNN → $dest ; next iteration = $((N + 1))"
ls -R "$dest"
```
