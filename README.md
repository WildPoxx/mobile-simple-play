# Mobile Simple Play

A phone interface for **Foundry VTT 14**, built around the **chat**.

It exists for a concrete case: a player who owns no computer and joins the table
through the browser on their phone. Every mobile VTT module starts from the map; this
one starts from the chat — because in Foundry the chat is not conversation, it is the
ledger of the table. Whoever has the chat has the game.

**Status: v0.1.10 — under test.** First run at a real table on 2026-08-22.
Verified against Foundry 14.367.

---

## Installing

In Foundry, as GM: **Add-on Modules → Install Module**, and paste into *Manifest URL*:

```
https://github.com/WildPoxx/mobile-simple-play/releases/latest/download/module.json
```

Then enable the module in the world (**Game Settings → Manage Modules**).

---

## The module is born switched off

This is the most important property of v0.1, and it is worth understanding before you
install:

> **Installing and enabling changes nothing for anyone.** Until mobile mode is turned
> on, the module adds no screen element, replaces no Foundry class and registers no
> event listener. It declares three settings and stays quiet.

The player is the one who turns it on, **on their own device**:

- when entering from a touch device, the module **asks once** whether it should turn on;
- the answer is stored **in that browser** (a `client`-scope setting, in `localStorage`);
- turning it on from a phone **does not affect** the GM, the other players, or the same
  player on another device.

### If something goes wrong

Mobile mode can be turned off in three ways, from the simplest to the most drastic:

1. inside mobile mode, the **More → Turn off mobile mode** button;
2. **Game Settings → Configure Settings → Mobile Simple Play → Mobile mode**, unchecked;
3. and, worst case, disable the module in **Manage Modules** — the world returns to
   normal, leaving nothing behind.

The module **writes nothing to the world**: it creates no document and sets no flag on
any actor, item, scene or message. Uninstalling leaves no residue.

---

## What v0.1 does

- **Full-screen chat**, with the SWADE roll cards exactly as they already are — Benny,
  reroll and damage buttons all working, because the system is still the one drawing them.
- **Action rail** on the left, holding:
  - the **weapons and items marked as favourites on the sheet** (SWADE's *Quick Access*);
  - the most-used **skills** (configurable; when blank, the five SWADE core skills plus
    Fighting and Shooting);
  - **status badges** — wounds, fatigue, Bennies — read-only;
  - the **target** button, at the foot.
- **Target picking from a list**: shows the tokens in the scene, hostiles first, toggled
  by tap. Works **even with the map not loaded**.
- **Bottom bar** with the **Chat** and **Map** tabs, the **character portrait** in the
  centre (opens the sheet) and the **More** button (write in chat, hotbar, turn off).
- **New-message pip** on the Chat tab while you are on the map.
- **Battery brake**: off the Map tab, the graphics engine stops drawing.
- **A quieter phone**: Foundry's permanent "this window is smaller than 1024x768"
  notice is suppressed while mobile mode is on. On a phone it is always true, never
  actionable, and it covers the chat.
- **Diagnostic log**: *More → Save diagnostic log* writes a text file with the
  console errors captured since mobile mode was turned on, plus the version, device
  and viewport details. There is no F12 on a phone; this is the substitute.

## What v0.1 does not do yet

- the **Quests** tab (reading mission Journals);
- **touch gestures on the map** — a token can be dragged, but panning is slippery,
  pinch-zoom does nothing, and the movement ruler paints over the scene;
- **reflow of the SWADE sheet**, which still breaks on narrow screens;
- spending a Benny from the rail;
- a proper configuration screen for the skills (for now it is a text field in settings).

---

## Requirements and target

- **Foundry VTT 14** (verified on 14.365).
- Designed for **Chrome on Android**, on screens from 360 px of logical width upwards.
  iPhone is not a target of this phase — parts of it should work, but nothing was tested.
- System: designed against **SWADE 6.0.4**. The rail reads `system.favorite` and calls
  `rollSkill`, both of which are SWADE's; on other systems the chat works and the rail
  comes up empty.

### One mobile module at a time

Do not run this alongside other modules that reorganise the interface on phones (Swipe
VTT, for example). Two modules fighting over the same layout produce a result that
cannot be diagnosed.

---

## Language

The module ships **in English**. A Brazilian Portuguese translation is included and is
selected automatically by the client's language setting; English is the source of truth,
and every string carries an English fallback in code, so a missing translation key can
never surface as a raw identifier on screen.

---

## Design principles

1. **Foundry is the authority.** The module invents no number, keeps no parallel state
   and decides no rule. Every roll is born in the system.
2. **Permissions are not worked around.** What the player cannot see on a computer, they
   do not see here.
3. **No app.** A browser, an address, done.
4. **The module is removable.** Uninstalling must not break the world or leave residue.
5. **No account, no proxy, no third-party service.**
6. **One-handed.** 48 px touch targets, no nested menus, no precise dragging.

---

## Development

The module has no build step: the files in the repository are the files Foundry
loads. There is a dry test harness — a fake Foundry built on jsdom — which
exercises mounting, the rail, targeting, the overlays, and above all the teardown.

```
cd test && npm install && node harness.mjs
```

It does not replace testing at a table. What it catches is the class of mistake that
would break someone's world: an API called the wrong way, a DOM that does not mount,
a global patched and never restored.

---

## Licence

MIT — see [LICENSE](LICENSE).

The module contains no third-party code. The design of the action rail was informed by
reading two MIT-licensed modules — `token-action-hud-swade` and `enhancedcombathud-swade`
— but not a single line was copied from either.
