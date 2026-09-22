# MVP verification

`npm run check` and `npm test` are required before merging every task branch.

The automated suite verifies bounded observation, URL and event redaction, unique target resolution, permit matching, explicit assertion outcomes, immutable result snapshots, and Record normalization. Browser tests run with Playwright Chromium.

Manual acceptance before release:

1. Start a visible Session and confirm that Assist pauses before a mutation.
2. Confirm an unknown page produces a Capture candidate and changes no accepted Model.
3. Confirm a destructive or unknown operation is blocked without a matching permit.
4. Confirm generated Playwright output contains neither permits nor secret values.
