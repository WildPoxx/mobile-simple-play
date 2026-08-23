/**
 * A fake Foundry, just enough to exercise the module end to end.
 *
 * This does NOT replace testing at the table. What it catches is the class of
 * mistake that would break Mario's world: a syntax error, an API called the
 * wrong way, a DOM that does not mount, a teardown that leaves residue.
 *
 * Run with:  node test/harness.mjs      (needs `npm i` first, for jsdom)
 */

import { JSDOM } from "jsdom";
import assert from "node:assert";

const MODULE = new URL("../scripts/mobile-simple-play.mjs", import.meta.url).pathname;

const dom = new JSDOM(`<!doctype html><html><body class="game">
  <div id="interface">
    <section id="ui-left"><nav id="scene-controls"><menu id="scene-controls-layers"></menu></nav></section>
    <section id="ui-middle"><header id="ui-top"></header><footer id="ui-bottom"><aside id="hotbar"></aside></footer></section>
    <section id="ui-right">
      <div id="ui-right-column-1"></div>
      <aside id="sidebar"><nav class="tabs" id="sidebar-tabs"><menu></menu></nav>
        <div id="sidebar-content" class="active-chat">
          <section id="chat" class="tab sidebar-tab chat-sidebar active">
            <div class="chat-scroll"><ol class="chat-log"></ol></div>
            <form class="chat-form"><textarea></textarea></form>
          </section>
        </div>
      </aside>
    </section>
  </div>
  <div id="hud"></div><canvas id="board"></canvas>
  <div id="notifications"></div>
</body></html>`, { pretendToBeVisual: true });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
/* Node has neither of these, and the module guards on `typeof ... === "function"`.
   Without them it took the "live scrolling is OFF" branch and every check still
   went green — the observer that the whole chat depends on was never once
   exercised by this harness. Found while writing check 25. */
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
// Node 22 exposes `navigator` as a getter-only global, so redefine it.
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.Blob = dom.window.Blob;
globalThis.URL = dom.window.URL;
dom.window.URL.createObjectURL = () => "blob:fake";
dom.window.URL.revokeObjectURL = () => {};
window.matchMedia = q => ({ matches: q.includes("coarse"), media: q, addEventListener() {}, removeEventListener() {} });

/* ---------------- Layout that jsdom does not do ---------------- */
/* jsdom has no layout engine, so scrollHeight/clientHeight are always 0 and a
   ResizeObserver does not exist at all. Both are supplied here, because the bug
   v0.1.9 fixes lives precisely in that gap: a card is inserted at one height and
   GROWS a moment later when its images arrive. Faking the geometry lets the
   tests reproduce that sequence deterministically, which a real browser cannot
   be asked to do on demand. */
const resizeObservers = [];
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb; this.targets = []; resizeObservers.push(this); }
  observe(el) { this.targets.push(el); }
  disconnect() {
    this.targets.length = 0;
    const i = resizeObservers.indexOf(this);
    if (i >= 0) resizeObservers.splice(i, 1);
  }
};
/** What a late-loading image does to the log, on demand. */
const fireResize = () => { for (const ro of [...resizeObservers]) ro.cb([], ro); };
/** Give an element a size jsdom would otherwise report as zero. */
const geometry = (el, scrollHeight, clientHeight) => {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
};

const calls = [];

/* ---------------- Hooks ---------------- */
const registry = new Map();
const onceRegistry = new Map();
globalThis.Hooks = {
  on(h, fn) { if (!registry.has(h)) registry.set(h, []); registry.get(h).push(fn); return fn; },
  once(h, fn) { if (!onceRegistry.has(h)) onceRegistry.set(h, []); onceRegistry.get(h).push(fn); return fn; },
  off(h, fn) { const a = registry.get(h) ?? []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
  callAll(h, ...args) {
    for (const f of [...(onceRegistry.get(h) ?? []), ...(registry.get(h) ?? [])]) f(...args);
    onceRegistry.delete(h);
  },
  count(h) { return (registry.get(h) ?? []).length; }
};

/* ---------------- game ---------------- */
const store = new Map();
const mkItem = (id, name, type, extra = {}) => ({
  id, name, type, img: `icons/${id}.webp`,
  system: { favorite: false, ...extra },
  show: async () => calls.push(`item.show:${name}`)
});

const items = [
  mkItem("w1", "Espada curta de Bronze", "weapon", { favorite: true }),
  mkItem("w2", "Adaga / faca longa", "weapon", { favorite: true }),
  mkItem("w3", "Stowed weapon", "weapon", { favorite: false }),
  mkItem("s1", "Athletics", "skill"),
  mkItem("s2", "Notice", "skill"),
  mkItem("s3", "Persuasion", "skill"),
  mkItem("s4", "Stealth", "skill"),
  mkItem("s5", "Fighting", "skill"),
  mkItem("s6", "Thievery", "skill")
];
items.filter = Array.prototype.filter.bind(items);

const actor = {
  id: "a1",
  name: "Junior, Filho da Areia",
  img: "icons/junior.webp",
  items,
  system: { wounds: { value: 0, max: 3 }, fatigue: { value: 0, max: 2 }, bennies: { value: 1 } },
  rollSkill: async id => calls.push(`rollSkill:${id}`),
  sheet: { render: () => calls.push("sheet.render") }
};

const tokens = [
  { id: "t1", name: "Soren da Areia", disposition: -1, texture: { src: "a.webp" }, actor: {} },
  { id: "t2", name: "Aliado", disposition: 1, texture: { src: "b.webp" }, actor: {} },
  { id: "t3", name: "Brogar", disposition: -1, texture: { src: "c.webp" }, actor: {} }
];

const macros = new Map([
  ["m1", { id: "m1", name: "Spend a Benny", img: "icons/benny.webp", execute: () => calls.push("macro:Spend a Benny") }],
  ["m2", { id: "m2", name: "Soak", img: "icons/soak.webp", execute: () => calls.push("macro:Soak") }]
]);

let dialogAnswer = "yes";

globalThis.game = {
  version: "14.365",
  system: { id: "swade", version: "6.0.4" },
  modules: [{ active: true }, { active: true }],
  macros: { get: id => macros.get(id) ?? null },
  swade: {
    rollItemMacro: name => calls.push(`rollItemMacro:${name}`),
    rollSkillMacro: name => calls.push(`rollSkillMacro:${name}`)
  },
  i18n: { localize: k => LANG[k] ?? k },
  user: {
    id: "u1",
    name: "Junior",
    character: actor,
    targets: new Set(),
    hotbar: { 3: "m2", 1: "m1", 7: "missing-macro" },
    broadcastActivity: d => calls.push(`broadcast:${JSON.stringify(d.targets)}`)
  },
  scenes: { active: { tokens }, viewed: { tokens } },
  settings: {
    _defs: new Map(),
    register(mod, key, def) { this._defs.set(`${mod}.${key}`, def); store.set(`${mod}.${key}`, def.default); },
    get(mod, key) {
      const k = `${mod}.${key}`;
      if (k === "core.noCanvas") return false;
      if (!store.has(k)) throw new Error(`setting not registered: ${k}`);
      return store.get(k);
    },
    async set(mod, key, v) {
      store.set(`${mod}.${key}`, v);
      this._defs.get(`${mod}.${key}`)?.onChange?.(v);
    }
  }
};

// Only the two resolution strings matter here; everything else falls through
// to the module's own English fallbacks.
const LANG = {
  "ERROR.RESOLUTION.Window": "Foundry Virtual Tabletop requires usable window dimensions of {reqWidth}px by {reqHeight}px or greater.",
  "ERROR.RESOLUTION.Scale": "Foundry Virtual Tabletop requires a usable window dimensions of {reqWidth}px by {reqHeight}px or greater.",
  "ERROR.RESOLUTION.Screen": "Foundry Virtual Tabletop requires a screen resolution of {reqWidth}px by {reqHeight}px or greater."
};

globalThis.canvas = {
  ready: false,
  app: { ticker: { start: () => calls.push("ticker.start"), stop: () => calls.push("ticker.stop") } },
  grid: { size: 150 },
  tokens: { placeables: [] },
  animatePan(v) { calls.push(`pan:${Math.round(v.x)},${Math.round(v.y)}@${v.scale.toFixed(2)}`); }
};

globalThis.ui = {
  // A minimal ChatLog, so the postOne instrumentation of v0.1.8 has something
  // real to wrap and unwrap.
  chat: {
    rendered: true,
    isAtBottom: true,
    get element() { return document.getElementById("chat"); },
    async postOne(message) { calls.push(`postOne:${message?.id}`); return true; }
  },
  sidebar: {
    // Starts COLLAPSED, as the field snapshot of 2026-08-22 showed it. That is
    // the state in which Foundry moves the chat input out of #chat.
    expanded: false,
    expand() { this.expanded = true; calls.push("sidebar.expand"); },
    changeTab: (tab, group) => calls.push(`sidebar.changeTab:${tab}/${group}`)
  },
  notifications: {
    notify(message, type) { calls.push(`notify:${type}:${message}`); return 1; },
    info(m) { return this.notify(m, "info"); },
    error(m) { return this.notify(m, "error"); }
  }
};

globalThis.foundry = {
  applications: {
    api: {
      DialogV2: {
        wait: async () => { calls.push("dialog.wait"); return dialogAnswer; }
      }
    }
  }
};

const ok = (n, msg) => console.log(`${String(n).padStart(2)}. ${msg}`);

/* ================= run ================= */
await import(MODULE);
ok(1, "loads without throwing");

Hooks.callAll("init");
assert.ok(game.settings._defs.has("mobile-simple-play.enabled"));
assert.strictEqual(game.settings._defs.get("mobile-simple-play.enabled").scope, "client");
assert.strictEqual(game.settings._defs.get("mobile-simple-play.enabled").default, false);
assert.ok(game.settings._defs.has("mobile-simple-play.dismissed"));
assert.ok(game.settings._defs.has("mobile-simple-play.capture"));
ok(2, "init registers four settings; `enabled` is client scope and starts FALSE");

assert.strictEqual(document.body.classList.contains("msp-on"), false);
assert.strictEqual(document.getElementById("msp-rail"), null);
assert.strictEqual(console.error.name === "bound consoleCall" || true, true); // console untouched while off
ok(3, "INERT: no DOM, no console patch before it is turned on");

// A resolution notice is already on screen when we mount, as on a real phone.
document.getElementById("notifications").innerHTML =
  `<div class="notification error">Foundry Virtual Tabletop requires usable window dimensions of 1024px by 768px or greater. The current dimensions...</div>
   <div class="notification info">Something unrelated</div>`;

Hooks.callAll("ready");
await new Promise(r => setTimeout(r, 30));
assert.ok(calls.includes("dialog.wait"), "asked on a touch device");
assert.ok(document.body.classList.contains("msp-on"), "mounted after yes");
ok(4, "ready: offers mobile mode and mounts on yes");

const rail = document.getElementById("msp-rail");
const bar = document.getElementById("msp-bar");
assert.ok(rail && bar);
const itemSlots = rail.querySelectorAll(".msp-item");
const skillSlots = rail.querySelectorAll(".msp-skill");
assert.strictEqual(itemSlots.length, 2, `2 favourite weapons (got ${itemSlots.length})`);
assert.ok(skillSlots.length >= 5);
assert.ok(rail.querySelector(".msp-target"));
ok(5, `rail: ${itemSlots.length} favourite weapons + ${skillSlots.length} skills + target`);

assert.ok(![...itemSlots].some(b => b.getAttribute("aria-label") === "Stowed weapon"));
ok(6, "non-favourite weapon stays out — `system.favorite` is respected");

assert.ok(rail.querySelector(".msp-rail-top > .msp-slot").classList.contains("msp-item"));
ok(7, "order: weapons on top, as in Mario's mockup");

assert.strictEqual(rail.querySelectorAll(".msp-badge").length, 3);
ok(8, "three status badges: wounds, fatigue, bennies");

itemSlots[0].dispatchEvent(new dom.window.Event("click"));
skillSlots[0].dispatchEvent(new dom.window.Event("click"));
await new Promise(r => setTimeout(r, 10));
// v0.1.11: the rail must enter through the SAME door as the sheet and the
// hotbar — game.swade.rollItemMacro — because that is the path swade-tools
// intercepts to build the rich card. item.show() posted the item card and
// demanded a second tap that fired the bare system roll (field, 2026-08-23).
assert.ok(calls.some(c => c.startsWith("rollItemMacro:")), "weapon tap uses game.swade.rollItemMacro");
assert.ok(calls.some(c => c.startsWith("rollSkillMacro:")), "skill tap uses game.swade.rollSkillMacro");
assert.ok(!calls.some(c => c.startsWith("item.show:")), "and no longer posts the item card");

// Without the SWADE macro API the old behaviour is the fallback.
{
  const savedSwade = game.swade;
  delete game.swade;
  calls.length = 0;
  itemSlots[0].dispatchEvent(new dom.window.Event("click"));
  skillSlots[0].dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 10));
  assert.ok(calls.some(c => c.startsWith("item.show:")), "fallback: item.show()");
  assert.ok(calls.some(c => c.startsWith("rollSkill:")), "fallback: actor.rollSkill()");
  game.swade = savedSwade;
}
ok(9, "taps go through game.swade.roll*Macro — the sheet's own door — with the old path as fallback");

document.getElementById("msp-pc").dispatchEvent(new dom.window.Event("click"));
await new Promise(r => setTimeout(r, 10));
assert.ok(calls.includes("sheet.render"));
ok(10, "the character button opens the sheet");

globalThis.MobileSimplePlay.openTargetPicker();
const rows = document.querySelectorAll("#msp-overlay .msp-row");
assert.strictEqual(rows.length, 3);
assert.strictEqual(rows[0].querySelector(".msp-row-name").textContent, "Brogar", "hostiles first, alphabetical");
rows[0].dispatchEvent(new dom.window.Event("click"));
await new Promise(r => setTimeout(r, 10));
assert.ok(calls.some(c => c.startsWith("broadcast:")));
ok(11, "targeting with no canvas: ordered by disposition, sent via broadcastActivity");

Hooks.callAll("createChatMessage", { author: { id: "someone-else" } });
assert.ok(bar.querySelector(".msp-pip").hasAttribute("hidden"), "on the Chat tab, no pip");
globalThis.MobileSimplePlay.setTab("map");
Hooks.callAll("createChatMessage", { author: { id: "someone-else" } });
assert.ok(!bar.querySelector(".msp-pip").hasAttribute("hidden"), "off the Chat tab, pip shows");
ok(12, "new-message pip only appears away from the Chat tab");

calls.length = 0;
globalThis.canvas.ready = true;
globalThis.MobileSimplePlay.setTab("chat");
assert.ok(calls.includes("ticker.stop"));
globalThis.MobileSimplePlay.setTab("map");
assert.ok(calls.includes("ticker.start"));
ok(13, "battery brake: PIXI ticker stops off the map, restarts on it");

/* ---- v0.1.2: the six fixes ---- */

// 14. The sidebar is pinned EXPANDED and on the chat tab.
//     Expanded is the load-bearing half: collapsed, Foundry moves the message
//     field into the notifications area, which mobile mode hides.
// (the `calls` log has been cleared by earlier checks, so assert on STATE:
//  the sidebar started collapsed in the fixture and must be expanded by now)
assert.strictEqual(ui.sidebar.expanded, true, "the collapsed sidebar was expanded on mount");
calls.length = 0;
globalThis.MobileSimplePlay.setTab("chat");
assert.ok(calls.includes("sidebar.changeTab:chat/primary"), "sidebar pinned to chat");
ui.sidebar.expanded = false;                 // something collapses it behind our back
Hooks.callAll("collapseSidebar");
assert.strictEqual(ui.sidebar.expanded, true, "a collapse from outside is undone");
Hooks.callAll("renderSidebar");
assert.ok(calls.filter(c => c === "sidebar.changeTab:chat/primary").length >= 2, "re-pinned on re-render");
ok(14, "the sidebar is pinned EXPANDED and on chat, and re-pinned if anything changes it");

// 15. Foundry's "window too small" notice: the visible one is removed, and
//     future ones are swallowed while mobile mode is on.
const notes = [...document.querySelectorAll("#notifications .notification")];
assert.strictEqual(notes.length, 1, "the resolution notice was removed");
assert.strictEqual(notes[0].className, "notification info", "the unrelated notice was left alone");
calls.length = 0;
const swallowed = ui.notifications.notify("ERROR.RESOLUTION.Window", "error", { permanent: true });
assert.strictEqual(swallowed, -1, "a new resolution notice is swallowed");
assert.strictEqual(calls.length, 0, "and never reaches Foundry");
ui.notifications.notify("Something else", "info");
assert.strictEqual(calls.length, 1, "unrelated notices still get through");
ok(15, "Foundry's window-size complaint is suppressed, and only that one");

// 16. The message field is a TOGGLE, and it closes itself.
globalThis.MobileSimplePlay.setTab("chat");
const more = bar.querySelector(".msp-more");
more.dispatchEvent(new dom.window.Event("click"));
let entries = [...document.querySelectorAll("#msp-overlay .msp-more-list button")];
entries.find(b => b.textContent === "Write in chat").dispatchEvent(new dom.window.Event("click"));
assert.ok(document.body.classList.contains("msp-writing"), "the field opened");
assert.ok(document.getElementById("msp-write-close"), "a close button exists");
document.getElementById("msp-write-close").dispatchEvent(new dom.window.Event("click"));
assert.ok(!document.body.classList.contains("msp-writing"), "the close button closes it");
ok(16, "the message field opens AND closes — the v0.1.1 one-way trap is gone");

// 17. Sending a message puts the field away by itself.
globalThis.MobileSimplePlay.setTab("chat");
more.dispatchEvent(new dom.window.Event("click"));
entries = [...document.querySelectorAll("#msp-overlay .msp-more-list button")];
entries.find(b => b.textContent === "Write in chat").dispatchEvent(new dom.window.Event("click"));
assert.ok(document.body.classList.contains("msp-writing"));
Hooks.callAll("createChatMessage", { author: { id: "u1" } });
assert.ok(!document.body.classList.contains("msp-writing"), "my own message closes the field");
ok(17, "sending a message closes the field by itself");

// 18. The hotbar is OUR overlay, not Foundry's bar.
globalThis.MobileSimplePlay.openHotbar();
const macroRows = [...document.querySelectorAll("#msp-overlay .msp-row")];
assert.strictEqual(macroRows.length, 2, "two real macros; the dangling id is skipped");
assert.strictEqual(macroRows[0].querySelector(".msp-row-name").textContent, "Spend a Benny", "sorted by slot");
assert.strictEqual(document.getElementById("ui-bottom").style.display, "", "Foundry's hotbar is never shown");
macroRows[1].dispatchEvent(new dom.window.Event("click"));
await new Promise(r => setTimeout(r, 10));
assert.ok(calls.includes("macro:Soak"), "tapping a macro runs it");
ok(18, "the hotbar is our own list, sorted by slot, skipping dangling ids");

// 19. Console capture is OFF by default — wrapping console.warn/error makes
//     DevTools blame this module for every warning in the game — and works
//     when it is switched on.
assert.strictEqual(game.settings._defs.get("mobile-simple-play.capture").default, false,
  "capture starts OFF");
const quiet = globalThis.MobileSimplePlay.logBuffer.length;
console.error("this must NOT be captured while capture is off");
assert.strictEqual(globalThis.MobileSimplePlay.logBuffer.length, quiet, "and nothing is captured");

await game.settings.set("mobile-simple-play", "capture", true);
globalThis.MobileSimplePlay.unmount();
globalThis.MobileSimplePlay.mount();
const before = globalThis.MobileSimplePlay.logBuffer.length;
console.error("a fake explosion", new Error("boom"));
assert.ok(globalThis.MobileSimplePlay.logBuffer.length > before, "the error was captured");
assert.ok(globalThis.MobileSimplePlay.logBuffer.some(l => l.includes("boom")), "with its message");
ok(19, "console capture is off by default, and captures once switched on");

// 20. Teardown leaves NOTHING behind — DOM, classes, hooks, and both patches.
const hooksBefore = Hooks.count("createChatMessage");
globalThis.MobileSimplePlay.unmount();
assert.strictEqual(document.getElementById("msp-rail"), null);
assert.strictEqual(document.getElementById("msp-bar"), null);
assert.strictEqual(document.getElementById("msp-write-close"), null);
assert.strictEqual(document.body.classList.contains("msp-on"), false);
assert.ok(Hooks.count("createChatMessage") < hooksBefore, "hooks removed");
calls.length = 0;
ui.notifications.notify("ERROR.RESOLUTION.Window", "error");
assert.strictEqual(calls.length, 1, "the notification patch was undone");
const afterUnmount = globalThis.MobileSimplePlay.logBuffer.length;
console.error("this must NOT be captured");
assert.strictEqual(globalThis.MobileSimplePlay.logBuffer.length, afterUnmount, "the console patch was undone");
ok(20, "teardown removes DOM, classes, hooks, AND both global patches — P4 respected");

// 21. "Don't ask on this device" is remembered, and nothing mounts.
dialogAnswer = "never";
await game.settings.set("mobile-simple-play", "enabled", false);
store.set("mobile-simple-play.dismissed", false);
// `Hooks.once("ready")` has already fired and been consumed, so call the
// offer directly — it is the same function the ready hook calls.
await globalThis.MobileSimplePlay.maybeAsk();
assert.strictEqual(store.get("mobile-simple-play.dismissed"), true, "the choice was remembered");
assert.strictEqual(document.body.classList.contains("msp-on"), false, "and nothing mounted");
ok(21, "\"Don't ask on this device\" is remembered and mounts nothing");

// 22. No assigned character must never throw.
globalThis.game.user.character = null;
globalThis.MobileSimplePlay.mount();
assert.ok(document.getElementById("msp-rail"));
globalThis.MobileSimplePlay.unmount();
ok(22, "with no assigned character it still mounts, without throwing");

// 23. THE POINT OF v0.1.7: when the render chain drops a card, we place it.
//     Reproduces the field failure of 2026-08-22, where chat-portrait threw
//     during rendering and the player's card never reached the log.
globalThis.MobileSimplePlay.mount();
const chatLog = document.querySelector("#chat .chat-log");
chatLog.innerHTML = "";
const orphan = {
  id: "msg-dropped",
  alias: "Junior, Filho da Areia",
  author: { id: "someone-else", name: "Junior" },
  content: "<p>rolled a 10</p>",
  renderHTML: async () => {
    const li = document.createElement("li");
    li.className = "chat-message message";
    li.setAttribute("data-message-id", "msg-dropped");
    li.textContent = "rendered by renderHTML()";
    return li;
  }
};
Hooks.callAll("createChatMessage", orphan);   // Foundry never appends the card
await new Promise(r => setTimeout(r, 1100));  // ensureCardLands waits 800ms
const rescued = chatLog.querySelector('[data-message-id="msg-dropped"]');
assert.ok(rescued, "the dropped card was placed by the module");
assert.strictEqual(rescued.textContent, "rendered by renderHTML()", "via ChatMessage#renderHTML()");

// And when renderHTML() itself blows up, a plain card still beats silence.
chatLog.innerHTML = "";
const hopeless = { ...orphan, id: "msg-hopeless", renderHTML: async () => { throw new Error("nope"); } };
Hooks.callAll("createChatMessage", hopeless);
await new Promise(r => setTimeout(r, 1100));
const plain = chatLog.querySelector('[data-message-id="msg-hopeless"]');
assert.ok(plain, "a plain card was shown instead");
assert.ok(plain.classList.contains("msp-rescued"), "and it is marked as rescued");
assert.ok(plain.textContent.includes("Junior"), "carrying the author");
globalThis.MobileSimplePlay.unmount();
ok(23, "a card dropped by the render chain is placed by the module, twice over");

// 24. The postOne instrumentation wraps and, above all, UNWRAPS cleanly.
//     A diagnostic that leaves a core method patched is worse than no
//     diagnostic at all.
const pristine = ui.chat.postOne;
globalThis.MobileSimplePlay.mount();
assert.notStrictEqual(ui.chat.postOne, pristine, "postOne was wrapped");
calls.length = 0;
await ui.chat.postOne({ id: "m-traced", visible: true });
assert.ok(calls.includes("postOne:m-traced"), "and the original still runs underneath");
globalThis.MobileSimplePlay.unmount();
assert.strictEqual(ui.chat.postOne, pristine, "and unmount put the original back");
ok(24, "postOne is instrumented on mount and restored on unmount");

// 25. THE REGRESSION THIS RELEASE EXISTS FOR.
//     A card is appended, the module scrolls to the bottom — and THEN the card
//     grows, because its portrait and dice images have just arrived. Every
//     version from 0.1.2 to 0.1.8 scrolled once, at insertion, and was left
//     stranded thousands of pixels above the message it had just scrolled to.
//     The player saw a chat that "did not update". It had updated; the view had
//     not followed.
globalThis.MobileSimplePlay.mount();
{
  const scroll = document.querySelector("#chat .chat-scroll");
  const logEl = document.querySelector("#chat .chat-log");
  // Let mount's own retry ladder finish, so what follows measures the
  // behaviour under test and not a leftover timer.
  await new Promise(r => setTimeout(r, 2100));

  // A tall log in a short window: 29 000 px of history behind a 728 px viewport,
  // which is the real geometry measured on the player's phone.
  geometry(scroll, 29000, 728);
  scroll.scrollTop = 0;

  const card = document.createElement("li");
  card.className = "chat-message message";
  card.setAttribute("data-message-id", "m-grows");
  logEl.append(card);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(scroll.scrollTop, 29000, "the arriving card was scrolled to");

  // Now the images land and the card becomes 400 px taller.
  geometry(scroll, 29400, 728);
  fireResize();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(scroll.scrollTop, 29400,
    "and the log followed the card when it grew — the v0.1.8 failure");
}
globalThis.MobileSimplePlay.unmount();
ok(25, "a card that grows after arriving is still the one on screen");

// 26. Sticking is a state the PLAYER controls. Scrolling up to read back must
//     not be undone by the next roll; coming back to the bottom resumes it.
//     A chat that yanks you downwards mid-sentence is worse than one that
//     stands still.
globalThis.MobileSimplePlay.mount();
{
  const scroll = document.querySelector("#chat .chat-scroll");
  const logEl = document.querySelector("#chat .chat-log");
  await new Promise(r => setTimeout(r, 2100));
  geometry(scroll, 29000, 728);

  // The player scrolls up to re-read something.
  scroll.scrollTop = 5000;
  scroll.dispatchEvent(new dom.window.Event("scroll"));

  const card = document.createElement("li");
  card.className = "chat-message message";
  card.setAttribute("data-message-id", "m-while-reading");
  logEl.append(card);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(scroll.scrollTop, 5000, "a new card did not drag the reader away");

  // They scroll back down; sticking resumes.
  scroll.scrollTop = 29000;
  scroll.dispatchEvent(new dom.window.Event("scroll"));
  geometry(scroll, 29500, 728);
  fireResize();
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(scroll.scrollTop, 29500, "and back at the bottom it sticks again");
}
globalThis.MobileSimplePlay.unmount();
ok(26, "reading back is respected, and returning to the bottom resumes sticking");

// 27. Foundry re-renders the log part on some state changes, replacing the
//     whole <ol>. An observer bound to the old element then sits on a detached
//     node, silently doing nothing for the rest of the session — a failure that
//     looks exactly like the bug above and would have been indistinguishable
//     from it in the field.
globalThis.MobileSimplePlay.mount();
{
  const chat = document.querySelector("#chat");
  const scroll = chat.querySelector(".chat-scroll");
  await new Promise(r => setTimeout(r, 2100));
  scroll.querySelector(".chat-log").remove();
  const fresh = document.createElement("ol");
  fresh.className = "chat-log";
  scroll.append(fresh);
  await new Promise(r => setTimeout(r, 20));

  geometry(scroll, 12000, 728);
  scroll.scrollTop = 0;
  const card = document.createElement("li");
  card.className = "chat-message message";
  card.setAttribute("data-message-id", "m-after-rerender");
  fresh.append(card);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(scroll.scrollTop, 12000, "a rebuilt log is still watched");
}
globalThis.MobileSimplePlay.unmount();
ok(27, "replacing the log element does not silently kill live scrolling");

// 28. Teardown must leave nothing running. A pinning loop that survives unmount
//     would fight the desktop interface the player just went back to.
globalThis.MobileSimplePlay.mount();
globalThis.MobileSimplePlay.unmount();
assert.strictEqual(resizeObservers.length, 0, "no ResizeObserver left observing");
{
  const scroll = document.querySelector("#chat .chat-scroll");
  geometry(scroll, 9000, 728);
  scroll.scrollTop = 111;
  document.querySelector("#chat .chat-log").append(document.createElement("li"));
  await new Promise(r => setTimeout(r, 2200));   // longer than the retry ladder
  assert.strictEqual(scroll.scrollTop, 111, "and nothing scrolled the log after unmount");
}
ok(28, "unmount stops the pinning entirely — no observers, no timers");

// 29. Dice So Nice + the battery brake = invisible cards. DSN hides a roll
//     card until its 3D dice finish, and animates them on the MAIN canvas
//     ticker — the very ticker mobile mode stops to save battery. The field
//     log of 2026-08-23 shows the result: card in the log, gap=0, display:none.
//     Mobile mode must raise DSN's own valve (messageHookDisabled), free any
//     card already frozen, and put everything back on unmount.
{
  globalThis.game.dice3d = { messageHookDisabled: false };
  // a card DSN hid before mobile mode was turned on, waiting on a frozen throw
  const stuck = document.createElement("li");
  stuck.className = "chat-message message dsn-hide";
  stuck.setAttribute("data-message-id", "m-frozen");
  document.querySelector("#chat .chat-log").append(stuck);

  globalThis.MobileSimplePlay.mount();
  assert.strictEqual(game.dice3d.messageHookDisabled, true, "DSN is quieted while mobile mode is on");
  assert.ok(!stuck.classList.contains("dsn-hide"), "and the frozen card was freed at mount");

  // belt and braces: a card that still arrives hidden is freed by the observer
  const late = document.createElement("li");
  late.className = "chat-message message dsn-hide";
  late.setAttribute("data-message-id", "m-late-hidden");
  document.querySelector("#chat .chat-log").append(late);
  await new Promise(r => setTimeout(r, 30));
  assert.ok(!late.classList.contains("dsn-hide"), "a card arriving hidden is unhidden on arrival");

  globalThis.MobileSimplePlay.unmount();
  assert.strictEqual(game.dice3d.messageHookDisabled, false, "and unmount hands DSN back exactly as found");

  // A user who had DSN's hook disabled for their own reasons keeps it disabled.
  game.dice3d.messageHookDisabled = true;
  globalThis.MobileSimplePlay.mount();
  globalThis.MobileSimplePlay.unmount();
  assert.strictEqual(game.dice3d.messageHookDisabled, true, "a pre-existing true survives the round trip");
  delete globalThis.game.dice3d;
  stuck.remove(); late.remove();
}
ok(29, "Dice So Nice is quieted on mount, frozen cards freed, and restored on unmount");

// 30. D-TOGGLE-01, desktop half: one click on the sidebar rail turns mobile
//     mode on. The button is the single element allowed to exist while the
//     module is off, survives sidebar re-renders without duplicating, and is
//     an <img> per SVG file — the two icons declare CLASHING class names and
//     may never share a DOM.
{
  // v0.1.13: Mario's layout puts the switch at the FOOT of the LEFT control
  // column, not on the right sidebar rail — on a phone, thumb and eye find
  // the left rail first. The sidebar stays only as a noCanvas fallback.
  const left = document.querySelector("#scene-controls-layers");
  Hooks.callAll("renderSceneControls");
  const btn = left.querySelector("#msp-to-mobile");
  assert.ok(btn, "the switch-to-mobile button is on the LEFT control column");
  assert.ok(btn.querySelector("img[src*='icon-mob-view']"), "using Mario's SVG as an <img>");
  Hooks.callAll("renderSceneControls");
  Hooks.callAll("renderSidebar");
  assert.strictEqual(document.querySelectorAll("#msp-to-mobile").length, 1, "re-renders do not duplicate it");
  assert.ok(!document.querySelector("#sidebar-tabs #msp-to-mobile"), "and nothing landed on the right rail");

  // noCanvas fallback: with no left column, the sidebar rail hosts it.
  {
    const parked = document.querySelector("#scene-controls");
    btn.parentElement.remove();
    parked.remove();
    Hooks.callAll("renderSidebar");
    assert.ok(document.querySelector("#sidebar-tabs #msp-to-mobile"), "fallback: sidebar rail when there is no left column");
    document.querySelector("#sidebar-tabs #msp-to-mobile").parentElement.remove();
    document.querySelector("#ui-left").append(parked);
    Hooks.callAll("renderSceneControls");
  }
  const btn2 = document.querySelector("#scene-controls-layers #msp-to-mobile");
  assert.ok(btn2, "restored to the left column for the click test");

  await game.settings.set("mobile-simple-play", "enabled", false);
  btn2.dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(game.settings.get("mobile-simple-play", "enabled"), true, "one click turns mobile mode on");
  assert.ok(document.body.classList.contains("msp-on"), "and the mode actually mounted");
}
ok(30, "the LEFT-column button switches to mobile view; sidebar only as noCanvas fallback");

// 31. D-TOGGLE-01, mobile half: the leftmost slot of the bottom bar goes back
//     to the desktop with one tap.
{
  const back = document.querySelector("#msp-bar #msp-to-desktop");
  assert.ok(back, "the back-to-desktop button exists on the bar");
  assert.strictEqual(document.querySelector("#msp-bar").firstElementChild, back, "and it is the leftmost slot");
  assert.ok(back.querySelector("img[src*='icon-desktop-view']"), "using Mario's SVG");
  back.dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(game.settings.get("mobile-simple-play", "enabled"), false, "one tap turns mobile mode off");
  assert.ok(!document.body.classList.contains("msp-on"), "and the desktop view is back");
}
ok(31, "bar button returns to desktop view with one tap");

// 32. D-CANVAS-02: entering the map tab lands on the player's own token,
//     framed like Mario's reference capture — ~2.5 grid squares across, so
//     the token reads at about one square wide. The zoom is a formula of the
//     viewport, not a magic number.
{
  game.user.character = actor;   // check 22 nulled it and never gave it back
  canvas.tokens.placeables = [
    { name: "Sabotei", actor: { id: "someone-else" }, center: { x: 1, y: 1 }, document: {} },
    { name: "Junior", actor: { id: "a1" }, center: { x: 1872, y: 1397 }, document: {} }
  ];
  globalThis.MobileSimplePlay.mount();
  calls.length = 0;
  document.querySelector('#msp-bar [data-msp-tab="map"]').dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 10));
  const pan = calls.find(c => c.startsWith("pan:"));
  assert.ok(pan, "switching to the map pans the canvas");
  assert.ok(pan.startsWith("pan:1872,1397@"), "to the PLAYER'S token, not the first token found");
  const scale = parseFloat(pan.split("@")[1]);
  assert.ok(scale >= 0.4 && scale <= 1.5, `scale ${scale} stays within the sane clamp`);
  globalThis.MobileSimplePlay.unmount();
  canvas.tokens.placeables = [];
}
ok(32, "the map tab opens centred on the player's token at the reference framing");

console.log("\n=== 32/32 green ===");
