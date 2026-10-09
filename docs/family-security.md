# Family authorization repair (PR #1)

Reviewed starting head: `2ee47344a129dec7c80cb54e326accdeb0c015eb`.

## Authorization model

- `families/{id}.members` is the authorization source. A user's `familyId` is only a UI pointer and cannot grant access.
- A new member must submit their own `joinProofs/{uid}` containing the invite code in an atomic batch with the self-add. Rules check both the current invitation mapping and the family's current code. Only that UID may be added; existing members cannot add, remove, replace or duplicate members through ordinary document updates.
- Family members may update `name` and `profile`. `inviteCode`, `createdAt` and arbitrary fields are immutable from the client. Membership administration needs a separately authorized future flow.
- Invitations can be read individually by authenticated users, but cannot be listed or overwritten. Creation is tied to the family's code and sole creator membership. Members can revoke an invitation by deleting it; all old proof-based joins then fail. This PR adds no revocation UI.
- Family creation, invitation publication and user pointer creation are atomic. Code collisions reject the whole batch instead of overwriting another family's invitation.
- Shared collections are explicitly allowed: fridge_items, recipes, folders, shopping_items and meal_plans. Authorization records are excluded from generic member writes.
- Account changes and failed family listeners clear stale family state.
- New six-character codes use cryptographic randomness; existing codes remain compatible.

## Verification

Run `pnpm install --frozen-lockfile` and `pnpm test:rules` with Node 22 and Java 21. The emulator uses the demo project `demo-family-cook`, not production. GitHub Actions runs rules tests, typecheck and build.

Local verification: 11/11 rules tests passed using Firebase CLI 13.35.1 / Firestore emulator 1.19.8 on Java 17 (the installed runtime). The checked-in CLI 15.33.0 requires Java 21, which CI provisions. Typecheck and production build passed. Browser UI end-to-end tests and production deployment were not performed.

Tests cover atomic creation, collision rejection, valid and repeated joins, shared inventory, profile edits, missing/invalid/cross-family proofs, direct self-add, extra-user injection, membership replacement/removal/duplication, invitation mutation/enumeration, anonymous access, forged user pointers, cross-family data access, revoked codes and stale proofs, and authorization-record writes.

## Deployment and remaining limits

Deploy the web client and `firestore.rules` together. The old client cannot join after the new rules are deployed. Existing families and invitations need no data migration. Production rules deployment is separate from committing this PR.

The six-character code remains a bearer secret with no expiry or server-side attempt rate limit. Rules prevent enumeration but cannot rate-limit repeated guesses. A rate-limited backend and longer/expiring tokens are the next step for an internet-facing production service. Existing `leaveToSwitch` only changes the selected-family pointer; it does not revoke membership. Changing that behavior requires an explicit leave/removal policy, especially for the last member.
