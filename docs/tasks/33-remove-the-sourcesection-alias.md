---
depends-on: [31, 32]
---

# Remove the sourceSection alias

Depends on [31] and [32]. After Hai's own consumers and
kandev-pacer read `sourceState` and stages, drop the `sourceSection` read
alias and patch alias, the `--section` CLI alias and the `TaskSection` type,
and update the docs, the skill and the tests accordingly.
