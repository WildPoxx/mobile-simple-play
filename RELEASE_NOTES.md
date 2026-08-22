Three defects from the field report of 2026-08-22, and one piece of
instrumentation so the next report carries proof instead of description.

### The bottom bar covered the last card

v0.1.3 marked only `position` as `!important` on `#ui-right`. The four offsets
were left unmarked, so a core rule of equal specificity could still win on
`bottom` and the middle ran under the navigation bar. All four offsets are now
`!important`, `#ui-right` and `#sidebar` clip their overflow, and the chat area
ends exactly where the bar begins.

### The chat did not scroll to new messages

v0.1.2 scrolled on the `createChatMessage` hook. That was too early: the hook
fires when the *document* is created, while Foundry renders the card through an
async queue. We scrolled to the bottom of a log that did not yet contain the
message; Foundry then appended it below the fold, and nothing moved until a
reload rebuilt the log.

A `MutationObserver` on the chat log now reacts to the card **arriving** rather
than to the message being created. The race is gone.

### The rail would not scroll under a finger

`.msp-rail-top` was a flex child without `min-height: 0`, so it refused to
shrink and never became scrollable. Added, together with `touch-action: pan-y`,
`-webkit-overflow-scrolling` and `overscroll-behavior: contain`.

### Instrumentation

Every incoming chat message now records, in the diagnostic log, the size of the
log before and after and whether the card actually reached the DOM:

```
message abc123: log 89 -> 90, card in DOM: true
```

If a message ever fails to appear again, that line says immediately whether the
card was never rendered or was rendered and merely not shown — two very
different bugs that look identical from the outside.

### Also

`compatibility.verified` moves to **14.367**, the version the table now runs.

### Not this release

The hit/damage controls remain absent for players. `swade-targeted-damage`
v3.1.1 restricts them to the message author or the GM, by its own design.
Nothing in this module touches them.
