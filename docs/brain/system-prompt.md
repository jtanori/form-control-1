# The system prompt (C-1)

Source of truth: [`packages/brain/src/prompt/system.ts`](../../packages/brain/src/prompt/system.ts).
`SYSTEM_PROMPT_VERSION` is `1.0.0`; it is logged with every request and included
in `meta.promptVersion`. A snapshot test fails on any wording change, which
forces a version bump and a re-run of the C-2 evals.

## Rules and why they exist

1. **Never invent element ids.** A hallucinated selector is worse than a
   clarification: it fills the wrong field silently. The server enforces this
   independently (`UNKNOWN_TARGET`), but the prompt must not rely on the guard.
2. **Badge references.** Users speak "field 5" while the model sees `vfe_37`.
   Every element carries `badgeIndex`, the number rendered on screen, and the
   prompt maps ordinals and digits onto it.
3. **Disabled fields are explained, not attacked.** Clicking them produces a
   timeout and a worse experience than a sentence.
4. **One action per field.** Duplicate actions re-trigger validation and
   produce duplicate error banners.
5. **Ambiguity is a question, not a guess.** "123 Main St" with Billing and
   Shipping groups must ask which one, quoting the real labels.
6. **Corrections beat history.** "Actually, change my first name to Jonathan"
   must override an earlier fill, using `conversationHistory` to find the field.
7. **Submit is a CLICK.** The extension adds the navigation guard; the model
   only picks the button by label.
8. **Spoken feedback is short and clean.** TTS reads it aloud; markdown, emoji
   and long sentences sound broken.
9. **Passwords are never echoed.** The prompt forbids repeating a dictated
   password, and `buildUserMessage` never receives password values (the DOM
   layer serialises `'<redacted>'`).
10. **Minimal work.** Fill only what the utterance covers — "fill everything
    you can" must not invent PII.

## Format normalisation

The table is reproduced verbatim in the prompt because models follow tables
better than prose: dates become `YYYY-MM-DD`, spoken emails drop "at"/"dot",
phone numbers become digits, spelled-out numbers become numerals, names split
across First/Last, and select values must match a real option label.

## Input compaction

`buildUserMessage()` emits short keys (`n` for badge, `ph` for placeholder,
`group` for group label), omits empty/false fields, caps options at 40 and
values at 200 characters. A 40-element checkout page costs ~1.2k prompt tokens.

## Changing the prompt

1. Edit `system.ts`, bump `SYSTEM_PROMPT_VERSION` (semver).
2. Update the snapshot: `pnpm --filter @vfe/brain test -u`.
3. Run `pnpm --filter @vfe/brain eval` (mock, free) and, with a key,
   `pnpm --filter @vfe/brain eval:live` (must stay ≥ 93%).
4. Record the change in `CHANGELOG.md`.
