## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem being solved. If this fixes a bug, what were the symptoms? -->

## How it was verified

<!-- Tick what actually ran. Paste output or a CI link where useful. -->

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (no new errors)
- [ ] `npm test` passes
- [ ] `npm run build:web` succeeds
- [ ] Verified manually (describe below)

<details>
<summary>Verification notes</summary>

</details>

## Checklist

- [ ] No secrets, tokens, or personal emails added to source
- [ ] New request bodies validated with a schema (`src/server/validation.ts`)
- [ ] New code paths covered by a test where practical
- [ ] No `@ts-ignore` / `as any` added without a comment explaining why
- [ ] If this touches `server.ts`, no duplicate declarations were introduced

## Risk & rollback

<!-- What breaks if this is wrong, and how would we revert? -->
