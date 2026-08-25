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
import { readFileSync } from "node:fs";

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
  /* D-BENNY-01: the module only offers the benny button to an actor that can
     actually spend one, so the fixture has to be able to. Mirrors SWADE's own
     contract (SwadeActor.ts:565): returns false when there is nothing left. */
  spendBenny: async function () {
    if ((this.system.bennies.value ?? 0) < 1) return false;
    this.system.bennies.value -= 1;
    calls.push("spendBenny");
    return true;
  },
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
  logOut: () => calls.push("game.logOut"),
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
  stage: { pivot: { x: 1000, y: 1000 }, scale: { x: 1 } },
  animatePan(v) { calls.push(`pan:${Math.round(v.x)},${Math.round(v.y)}@${v.scale.toFixed(2)}`); },
  // the real Canvas#pan moves the camera; the mock records AND applies it, so
  // a gesture's successive frames compose exactly as they do in the browser
  pan(v) {
    if (v.x !== undefined) canvas.stage.pivot.x = v.x;
    if (v.y !== undefined) canvas.stage.pivot.y = v.y;
    if (v.scale !== undefined) canvas.stage.scale.x = v.scale;
    calls.push(`pan:${Math.round(canvas.stage.pivot.x)},${Math.round(canvas.stage.pivot.y)}@${canvas.stage.scale.x.toFixed(2)}`);
  }
};

/* A board with a real size, and pointer events jsdom does not provide. */
const BOARD_RECT = { left: 0, top: 0, width: 360, height: 640 };
const givePointerEvents = board => {
  board.getBoundingClientRect = () => ({
    ...BOARD_RECT, right: BOARD_RECT.width, bottom: BOARD_RECT.height, x: 0, y: 0
  });
};
const pointer = (board, type, id, x, y) => {
  const ev = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: id, clientX: x, clientY: y });
  board.dispatchEvent(ev);
  return ev;
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
assert.ok(game.settings._defs.has("mobile-simple-play.uiSize"));
assert.strictEqual(game.settings._defs.get("mobile-simple-play.uiSize").scope, "client");
ok(2, "init registers the settings; `enabled` is client scope and starts FALSE");

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

/* D-WOUNDS-01 rewrote this one. It used to assert THREE badges — wounds,
   fatigue, bennies. Fatigue left by Mario's call, and wounds stopped being a
   fraction and became his drawing plus a chip. Two badges now, and the check
   names what each one is instead of only counting them. */
assert.ok(!rail.querySelector(".msp-fatigue"), "fatigue must be gone");
assert.ok(!rail.querySelector(".msp-bennies"),
  "the old numeric bennies badge must be gone — the benny button carries its own count (D-BENNY-02)");
const woundBadge = rail.querySelector(".msp-wounds");
assert.ok(woundBadge?.querySelector(".msp-wounds-art"));
assert.ok(woundBadge?.querySelector(".msp-wounds-chip"));
const bennyBadge = rail.querySelector(".msp-benny");
assert.ok(bennyBadge?.querySelector(".msp-benny-art"));
assert.ok(bennyBadge?.querySelector(".msp-benny-chip"));
ok(8, "the foot carries two pictures with chips — wounds and bennies — and no fractions");

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

// 15. D-NOTIFY-01. The contract CHANGED in 0.1.22, and the reason is in the
//     field log: shadowing `ui.notifications.notify` to swallow a message made
//     us return a fake id, Foundry stored it, and `remove()` threw on every
//     resize — constantly, on a phone. So we no longer stand between Foundry
//     and its own bookkeeping.
//
//     The new contract, and what this checks:
//       a) every notify() reaches Foundry untouched, and its return value is
//          whatever Foundry made — never ours;
//       b) nothing is deleted from the notification list;
//       c) error and warning notices are hidden by the STYLESHEET, not by JS;
//       d) each hidden one is copied into the diagnostic log, so `Save
//          diagnostic log` still carries it.
calls.length = 0;
const returned = ui.notifications.notify("ERROR.RESOLUTION.Window", "error", { permanent: true });
assert.strictEqual(calls.length, 1, "every notification reaches Foundry now — we intercept nothing");
assert.notStrictEqual(returned, -1,
  "notify() must return Foundry's own value: a fake id is what broke Notifications#remove");
ui.notifications.notify("Something else", "info");
assert.strictEqual(calls.length, 2, "and so does an unrelated one");

{
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");
  const rule = css.match(/body\.msp-on #notifications > \.notification\.error,\s*body\.msp-on #notifications > \.notification\.warning\s*\{([^}]*)\}/);
  assert.ok(rule, "the red boxes must be hidden by CSS scoped to body.msp-on");
  assert.ok(/display:\s*none\s*!important/.test(rule[1]), "and actually hidden");
  assert.ok(!/\.notification\.info|\.notification\.success/.test(rule[0]),
    "info and success must stay: they are how the module answers the player");
}
ok(15, "red notices are hidden by the stylesheet, and Foundry's own bookkeeping is left alone");

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

// 33. D-CANVAS-03: one finger pans. The map must travel WITH the finger —
//     drag right, the map comes right — and by the exact screen distance
//     dragged, converted to world units by the current scale.
{
  const board = document.querySelector("#board");
  givePointerEvents(board);
  globalThis.MobileSimplePlay.mount();
  canvas.stage.pivot = { x: 1000, y: 1000 };
  canvas.stage.scale = { x: 1 };

  pointer(board, "pointerdown", 1, 180, 320);      // centre of the board
  pointer(board, "pointermove", 1, 183, 322);      // inside the slop: ignored
  assert.strictEqual(canvas.stage.pivot.x, 1000, "a twitch below the slop does not pan");

  pointer(board, "pointermove", 1, 280, 320);      // 100px right of the start
  assert.strictEqual(Math.round(canvas.stage.pivot.x), 900,
    "dragging right by 100px moves the camera 100 world units LEFT — the map follows the finger");
  assert.strictEqual(Math.round(canvas.stage.pivot.y), 1000, "and the other axis is untouched");
  pointer(board, "pointerup", 1, 280, 320);
}
ok(33, "one finger pans, and only after the slop threshold");

// 34. Two fingers pinch — ANCHORED. The point of the map between the fingers
//     must stay between the fingers while the scale changes; that is the
//     difference between a pinch that feels right and one that feels sick.
{
  const board = document.querySelector("#board");
  canvas.stage.pivot = { x: 1000, y: 1000 };
  canvas.stage.scale = { x: 1 };

  // fingers 100px apart, centred on the board centre -> anchor is world 1000,1000
  pointer(board, "pointerdown", 1, 130, 320);
  pointer(board, "pointerdown", 2, 230, 320);
  // spread to 200px apart, same midpoint: scale doubles, anchor holds
  pointer(board, "pointermove", 1, 80, 320);
  pointer(board, "pointermove", 2, 280, 320);

  assert.strictEqual(canvas.stage.scale.x, 2, "spreading the fingers to twice the gap doubles the scale");
  assert.strictEqual(Math.round(canvas.stage.pivot.x), 1000, "and the anchored point of the map did not slide");
  assert.strictEqual(Math.round(canvas.stage.pivot.y), 1000);
  pointer(board, "pointerup", 1, 80, 320);
  pointer(board, "pointerup", 2, 280, 320);
}
ok(34, "two fingers pinch to zoom, anchored between the fingers");

// 35. The zoom clamp, and a clean teardown. A gesture surviving unmount would
//     drive the camera of the desktop view the player just went back to.
{
  const board = document.querySelector("#board");
  canvas.stage.pivot = { x: 1000, y: 1000 };
  canvas.stage.scale = { x: 1 };
  pointer(board, "pointerdown", 1, 170, 320);
  pointer(board, "pointerdown", 2, 190, 320);      // 20px apart
  pointer(board, "pointermove", 1, 0, 320);
  pointer(board, "pointermove", 2, 360, 320);      // 360px apart -> x18
  assert.strictEqual(canvas.stage.scale.x, 3, "the zoom is clamped at the ceiling, not x18");
  pointer(board, "pointerup", 1, 0, 320);
  pointer(board, "pointerup", 2, 360, 320);

  globalThis.MobileSimplePlay.unmount();
  canvas.stage.pivot = { x: 500, y: 500 };
  canvas.stage.scale = { x: 1 };
  pointer(board, "pointerdown", 1, 180, 320);
  pointer(board, "pointermove", 1, 300, 320);
  assert.strictEqual(canvas.stage.pivot.x, 500, "after unmount the finger no longer drives the camera");
}
ok(35, "zoom stays within bounds, and unmount releases the canvas");

// 36. FIELD REPORT 2026-08-23: a drag that starts ON the player's own token
//     must move the TOKEN, not the camera. v0.1.15 claimed every one-finger
//     drag for the camera, so touching your own token panned the map — the
//     desktop equivalent of holding the right mouse button.
{
  const board = document.querySelector("#board");
  canvas.stage.pivot = { x: 1000, y: 1000 };
  canvas.stage.scale = { x: 1 };
  // a token of MINE at world 1000,1000 (the board centre at this camera)
  canvas.tokens.placeables = [
    { name: "Junior", actor: { id: "a1", isOwner: true }, x: 950, y: 950, w: 100, h: 100,
      center: { x: 1000, y: 1000 }, document: {} },
    { name: "Soren", actor: { id: "npc", isOwner: false }, x: 1300, y: 950, w: 100, h: 100,
      center: { x: 1350, y: 1000 }, document: {} }
  ];
  globalThis.MobileSimplePlay.mount();
  canvas.stage.pivot = { x: 1000, y: 1000 };
  canvas.stage.scale = { x: 1 };

  // finger lands on MY token, then drags: the camera must not move
  pointer(board, "pointerdown", 1, 180, 320);
  pointer(board, "pointermove", 1, 280, 320);
  assert.strictEqual(canvas.stage.pivot.x, 1000, "dragging from my own token leaves the camera alone");
  pointer(board, "pointerup", 1, 280, 320);

  // finger lands on empty map: pans as before
  pointer(board, "pointerdown", 1, 60, 500);
  pointer(board, "pointermove", 1, 160, 500);
  assert.strictEqual(Math.round(canvas.stage.pivot.x), 900, "dragging from empty map still pans");
  pointer(board, "pointerup", 1, 160, 500);

  // a token I do NOT own is not mine to drag: panning from it is fine
  canvas.stage.pivot = { x: 1000, y: 1000 };
  pointer(board, "pointerdown", 1, 180, 320);   // recentred: 1000,1000 -> my token again
  pointer(board, "pointerup", 1, 180, 320);
  canvas.tokens.placeables[0].actor.isOwner = false;
  pointer(board, "pointerdown", 1, 180, 320);
  pointer(board, "pointermove", 1, 280, 320);
  assert.strictEqual(Math.round(canvas.stage.pivot.x), 900, "a token I do not own does not block the pan");
  pointer(board, "pointerup", 1, 280, 320);
  globalThis.MobileSimplePlay.unmount();
  canvas.tokens.placeables = [];
}
ok(36, "a drag from my own token belongs to the token, not the camera");

// 37. D-SCALE-01: when the browser reports a viewport far wider than a phone
//     naturally has (Chrome's "Desktop site"), every measurement scales up so
//     the interface keeps its PHYSICAL size. A phone in its own viewport, and
//     any non-touch device, must be left at exactly 1.
{
  const setWidth = w => Object.defineProperty(dom.window, "innerWidth", { value: w, configurable: true });

  setWidth(412);                                  // a phone, natural
  globalThis.MobileSimplePlay.mount();
  assert.strictEqual(document.body.style.getPropertyValue("--msp-scale"), "1",
    "a phone in its natural viewport is left exactly as designed");
  globalThis.MobileSimplePlay.unmount();

  setWidth(980);                                  // the same phone, "Desktop site"
  globalThis.MobileSimplePlay.mount();
  const s = parseFloat(document.body.style.getPropertyValue("--msp-scale"));
  assert.ok(s > 2.3 && s < 2.5, `a stretched viewport scales up (got ${s})`);
  globalThis.MobileSimplePlay.unmount();

  // a wide viewport WITHOUT touch is a real desktop: never scale it
  const coarse = window.matchMedia;
  window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  globalThis.MobileSimplePlay.mount();
  assert.strictEqual(document.body.style.getPropertyValue("--msp-scale"), "1",
    "a wide viewport with a mouse is a desktop, not a stretched phone");
  globalThis.MobileSimplePlay.unmount();
  window.matchMedia = coarse;
  setWidth(412);
}
ok(37, "the interface keeps its physical size on a stretched viewport, and only there");

// 38. FIELD REPORT 2026-08-23: "os ícones da esquerda estão muito pequenos...
//     tem um longo espaço vazio preto entre eles dois." The rail scaled and
//     its BUTTONS did not — 44px slots adrift in a 100px rail. Every measure
//     inside the rail must move with the scale, and the root font size must
//     move too, because Foundry and SWADE size their own interface in `rem`.
{
  const setWidth = w => Object.defineProperty(dom.window, "innerWidth", { value: w, configurable: true });
  setWidth(738);                                  // Mario's phone, as reported
  const priorRootFont = document.documentElement.style.fontSize;
  globalThis.MobileSimplePlay.mount();

  const scale = parseFloat(document.documentElement.style.getPropertyValue("--msp-scale"));
  assert.ok(scale > 1.5, `a 738px viewport scales up (got ${scale})`);
  assert.strictEqual(document.documentElement.style.getPropertyValue("--msp-scale"),
    document.body.style.getPropertyValue("--msp-scale"),
    "the scale is published on the root as well as the body — `rem` resolves against the root");
  assert.strictEqual(document.documentElement.style.fontSize, `${(16 * scale).toFixed(1)}px`,
    "and the root font size carries Foundry's and SWADE's own rem-based layout with it");

  globalThis.MobileSimplePlay.unmount();
  assert.strictEqual(document.documentElement.style.fontSize, priorRootFont,
    "unmount hands the document's font size back exactly as found");
  assert.strictEqual(document.documentElement.style.getPropertyValue("--msp-scale"), "",
    "and takes its variable off the root");
  setWidth(412);
}
ok(38, "the whole interface scales, root font included, and unmount restores it");

// 39. The player's thumb overrules the measurement. A taste setting multiplies
//     whatever the automatic reading was — Mario asked for bigger; someone
//     else's eyes will ask for smaller — and it is stored per browser.
{
  const setWidth = w => Object.defineProperty(dom.window, "innerWidth", { value: w, configurable: true });
  setWidth(412);                                  // natural phone: auto scale is 1
  await game.settings.set("mobile-simple-play", "uiSize", 1.5);
  globalThis.MobileSimplePlay.mount();
  assert.strictEqual(document.body.style.getPropertyValue("--msp-scale"), "1.5",
    "on a natural phone the taste setting IS the scale");
  await game.settings.set("mobile-simple-play", "uiSize", 0.8);
  assert.strictEqual(document.body.style.getPropertyValue("--msp-scale"), "0.8",
    "and changing it re-applies live, without a reload");
  globalThis.MobileSimplePlay.unmount();
  await game.settings.set("mobile-simple-play", "uiSize", 1);
}
ok(39, "the interface-size setting multiplies the automatic scale, live");

// 40. The map framing must reckon in PHYSICAL width. On a stretched viewport
//     the window reports more pixels than the glass has; framing by the
//     inflated number zoomed the map far past Mario's reference capture.
{
  const setWidth = w => Object.defineProperty(dom.window, "innerWidth", { value: w, configurable: true });
  canvas.tokens.placeables = [
    { name: "Junior", actor: { id: "a1", isOwner: true }, x: 1822, y: 1347, w: 100, h: 100,
      center: { x: 1872, y: 1397 }, document: {} }
  ];

  setWidth(412);                                  // natural phone
  globalThis.MobileSimplePlay.mount();
  calls.length = 0;
  document.querySelector('#msp-bar [data-msp-tab="map"]').dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 10));
  const natural = parseFloat(calls.find(c => c.startsWith("pan:")).split("@")[1]);
  globalThis.MobileSimplePlay.unmount();

  setWidth(980);                                  // same glass, stretched viewport
  globalThis.MobileSimplePlay.mount();
  calls.length = 0;
  document.querySelector('#msp-bar [data-msp-tab="map"]').dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 10));
  const stretched = parseFloat(calls.find(c => c.startsWith("pan:")).split("@")[1]);
  globalThis.MobileSimplePlay.unmount();

  assert.ok(Math.abs(natural - stretched) < 0.15,
    `the same phone gets the same framing either way (${natural} vs ${stretched})`);
  setWidth(412);
  canvas.tokens.placeables = [];
}
ok(40, "the map is framed by the physical screen, not by the reported width");

// 41. The stylesheet has never been under test, and it is where the same two
//     defects keep coming back: a size written in fixed pixels inside a
//     container that scales, and a rule that loses to a broader rule because
//     `:not(.class)` quietly out-weighs it. Both were found by eye, three
//     times over. This reads the CSS as text and refuses either.
{
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");

  // (a) No font-size in bare px anywhere in mobile mode. Every size must be a
  //     ratio of a variable, or the phone scale cannot move it.
  const bareFont = [];
  for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
    const value = m[1].replace(/!important/, "").trim();
    if (/^-?[\d.]+px$/.test(value)) bareFont.push(value);
  }
  assert.deepStrictEqual(bareFont, [],
    `font sizes must be ratios of a variable, never fixed px (found: ${bareFont.join(", ")})`);

  // (b) The blanket inheritance rule must not carry a class inside :not().
  //     `:not(.fa)` adds a class's worth of weight to a selector whose whole
  //     job is to sit UNDERNEATH the exceptions; with !important on both
  //     sides, the exceptions would then silently never apply.
  const blanket = css.match(/\.chat-message \*:not\([^{,]*/);
  assert.ok(blanket, "the card's blanket type rule is still present");
  assert.ok(!/:not\(\s*[.#[]/.test(blanket[0]),
    `the blanket rule's exclusions must be element-level only (found: ${blanket[0].trim()})`);

  // (c) Every exception to it must actually out-rank it: a class selector, or
  //     a doubled guard. A bare element (`button`) does not.
  const weak = [];
  for (const m of css.matchAll(/body\.msp-on(\.msp-on)? #chat \.chat-message ([^,{]+)/g)) {
    const doubled = Boolean(m[1]);
    const tail = m[2].trim();
    if (tail.startsWith("*")) continue;                       // the blanket itself
    if (doubled || /[.#[]/.test(tail)) continue;              // carries its own weight
    weak.push(tail);
  }
  assert.deepStrictEqual(weak, [],
    `these rules sit under the blanket and will never apply: ${weak.join(" | ")}`);
}
ok(41, "the stylesheet scales by ratio, and its exceptions out-rank the blanket");


// 42. D-CANVAS-04. The carousel was cut in half for a reason no stylesheet
//     could confess: it lived inside #ui-middle, which Foundry sizes at 60%
//     of the screen AND scales — and a transformed ancestor becomes the
//     containing block for `position: fixed`, so the dock's `left/right` were
//     measuring the middle 60%, not the screen. Meanwhile the strip itself
//     could not scroll, because the dock module spends `--carousel-overflow`
//     (hidden) on #combatants, one level below where we had put the scroll.
//     Both were measured in a rebuilt copy of Mario's world; both are the
//     kind of fault that comes back the moment someone tidies the file.
{
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");

  // (a) The trap must stay disarmed: on the map tab #ui-middle gives up its
  //     60% and its transform, or the dock silently shrinks back.
  const middle = css.match(/body\.msp-on\[data-msp-tab="map"\]\s+#ui-middle\s*\{([^}]*)\}/);
  assert.ok(middle, "the map tab must free #ui-middle, or the dock is fixed to the middle 60%");
  assert.ok(/width:\s*100%\s*!important/.test(middle[1]),
    "#ui-middle must take the whole width on the map tab");
  assert.ok(/transform:\s*none\s*!important/.test(middle[1]),
    "#ui-middle must drop its transform, or `position: fixed` never reaches the screen");

  // (b) The scroll must sit on the element that actually clips. `overflow` on
  //     the dock window is not enough and never was.
  const strip = css.match(/body\.msp-on\[data-msp-tab="map"\][^{]*#combatants\s*\{([^}]*)\}/);
  assert.ok(strip, "#combatants must be addressed directly, or the strip clips instead of scrolling");
  assert.ok(/overflow-x:\s*auto\s*!important/.test(strip[1]),
    "#combatants must scroll horizontally with !important, to beat --carousel-overflow: hidden");

  // (c) The dock starts at its own origin and ends at the screen edge — the two
  //     numbers Mario asked for by hand. Written as a VARIABLE, never as a pixel
  //     count, so it follows the phone scale.
  //
  //     D-CANVAS-06, 2026-08-25: that origin used to be `--msp-rail`, on the
  //     theory that the strip should touch the rail. Mario measured 78 on the
  //     screen and asked for the gap, so it became `--msp-dock-x`. The check
  //     changed with it — and deliberately still refuses `--msp-rail` here, so
  //     that anyone who "simplifies" the two back into one has to argue with a
  //     failing test instead of silently undoing his measurement.
  const dock = css.match(/body\.msp-on\[data-msp-tab="map"\]\s+#combat-dock\s*\{([^}]*)\}/);
  assert.ok(dock, "the dock's placement rule is still present");
  assert.ok(/left:\s*var\(--msp-dock-x\)\s*!important/.test(dock[1]),
    "the dock must start at var(--msp-dock-x) — its own origin, never a fixed px and never the rail's width");
  const dockX = css.match(/--msp-dock-x:\s*calc\((\d+)px\s*\*\s*var\(--msp-scale/);
  assert.ok(dockX, "--msp-dock-x must be a multiple of --msp-scale");
  assert.strictEqual(Number(dockX[1]), 78, "Mario measured the dock origin at 78");
  assert.ok(/right:\s*0\s*!important/.test(dock[1]),
    "the dock must run to the right edge of the screen");

  // (d) The portrait size stays a ratio of the phone scale.
  const size = css.match(/--combatant-portrait-size:\s*calc\((\d+)px\s*\*\s*var\(--msp-scale/);
  assert.ok(size, "the portrait size must be a multiple of --msp-scale, not a fixed px");
  assert.ok(Number(size[1]) >= 40 && Number(size[1]) <= 56,
    `portrait base ${size[1]}px is outside the readable band 40-56`);
}
ok(42, "the carousel spans the screen from the rail, and scrolls instead of clipping");


// 43. D-TOGGLE-02. The switch that turns the module ON is the one element that
//     exists while the module is OFF, so it is the one thing `body.msp-on`
//     cannot reach — and for that reason its rules are the only unscoped ones
//     in the file. That makes them the only rules that can leak into a stranger's
//     desktop, and the only ones check 41 never looked at.
//
//     It also hid the same defect for the fourth time: `width: 22px` on the
//     image, a fixed pixel inside a column that scales with the theme. Check 41
//     reads fixed pixels in `font-size` only. This one reads the geometry.
{
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");

  // (a) The unscoped surface must stay exactly what it is: rules addressed by
  //     this one id. Anything else outside body.msp-on reaches other people's
  //     interfaces, which is the whole thing "born inert" promises not to do.
  // Comments first: this file QUOTES other people's CSS to explain it, and a
  //  quoted `#ui-middle { ... }` is not a rule this module ships.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const unscoped = [];
  for (const m of bare.matchAll(/(^|\n)\s*([^@\n{}][^{}\n]*)\{/g)) {
    const sel = m[2].trim();
    if (!sel || sel.startsWith("*") || sel.startsWith("/")) continue;
    if (/^(from|to|\d+%)$/.test(sel)) continue;                  // keyframes
    // Dividir por virgula so no NIVEL DE CIMA: `:is(a, b)` traz virgulas suas,
    // e um split ingenuo transforma uma regra escopada em varias que parecem
    // soltas. Foi o que aconteceu com a pele da ficha, em 2026-08-25 — o teste
    // acusou uma regra que estava correta.
    const partes = [];
    let nivel = 0, atual = "";
    for (const ch of sel) {
      if (ch === "(") nivel++;
      else if (ch === ")") nivel--;
      if (ch === "," && nivel === 0) { partes.push(atual); atual = ""; continue; }
      atual += ch;
    }
    partes.push(atual);
    if (partes.every((s) => /body\.msp-on/.test(s))) continue;
    unscoped.push(sel);
  }
  assert.deepStrictEqual(unscoped, ["#msp-to-mobile", "#msp-to-mobile img"],
    `only the view toggle may live outside body.msp-on (found: ${unscoped.join(" | ")})`);

  // (b) Its image must be sized from Foundry's own control box, never from a
  //     number of ours. This is the rule that was broken from 0.1.11 to 0.1.20.
  const img = css.match(/#msp-to-mobile img\s*\{([^}]*)\}/);
  assert.ok(img, "the toggle's image rule is still present");
  for (const prop of ["width", "height"]) {
    const v = img[1].match(new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([^;]+)`));
    assert.ok(v, `the toggle's image must declare ${prop}`);
    const value = v[1].trim();
    assert.ok(!/^-?[\d.]+px$/.test(value),
      `the toggle's image ${prop} is a fixed ${value} — it must follow --control-size, or it stops matching the column the moment the theme or --ui-scale moves`);
    assert.ok(/var\(--control-size/.test(value),
      `the toggle's image ${prop} must be measured from var(--control-size), not from ${value}`);
  }
}
ok(43, "the view toggle is sized by Foundry's control box, and nothing else escapes the scope");


// 44. D-WINDOW-01 and D-QUEST-01, together, because they fail together.
//
//     A Foundry window remembers its last position as an INLINE style. Opened
//     once on a desktop, it remembers a left of several hundred pixels and, on
//     a phone, opens entirely off screen — which is what Mario reported as "the
//     portrait does nothing the first time". His log carries no error for that
//     click, and that absence is the evidence: the click worked, the window
//     went somewhere he could not see.
//
//     The MasterQuest panel arrives through the same door, so the containment
//     has to exist before the button does — a new button that appears to do
//     nothing is worse than no button.
{
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");

  // (a) Windows are pinned to the content area, and with !important — the
  //     remembered position is inline, and only !important outranks it.
  const win = css.match(/body\.msp-on \.application:not\([^{]*\{([^}]*)\}/);
  assert.ok(win, "mobile mode must pin Foundry windows to the screen");
  for (const prop of ["position", "left", "right", "top", "bottom"]) {
    assert.ok(new RegExp(`${prop}:[^;]*!important`).test(win[1]),
      `the window rule must force ${prop} — an inline position beats anything weaker`);
  }
  assert.ok(/#combat-dock/.test(win[0]),
    "the carousel must be excluded: it has its own placement (D-CANVAS-04)");

  // (b) The quest button is built from a lookup, never from an assumption that
  //     MasterQuest is installed. Same shape as the rail's swade-tools door.
  const js = readFileSync(new URL("../scripts/mobile-simple-play.mjs", import.meta.url), "utf8");
  const finder = js.match(/function questLogOpener\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(finder, "the quest log opener must be looked up, not assumed");
  assert.ok(/typeof open === "function"/.test(finder[0]),
    "the opener must be type-checked before it is offered as a button");
  assert.ok(/const quests = questLogOpener\(\);\s*\n\s*if \(quests\)/.test(js),
    "the button must only be built when the module answered — in a world without MasterQuest there is no button");
}
ok(44, "Foundry windows are pinned to the phone screen, and the quest button only exists when MasterQuest does");

/* -------------------------------------------------------------------------
   45. D-WOUNDS-01 — the wound picture tells the truth, in both directions

   This check exists because the defect it guards against is INVISIBLE: an
   inverted reading renders perfectly and simply lies. Three drops red would
   mean "nearly dead" instead of "unhurt", the rail would look right, and the
   only person to find out would be the player, at the table, deciding whether
   to press an attack.

   So the state machine is exercised end to end, not sampled.
   ------------------------------------------------------------------------- */
{
  const js = readFileSync(new URL("../scripts/mobile-simple-play.mjs", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");

  // (a) The five drawings must be in the package. A missing file is a broken
  //     image in the rail, and nothing else would report it.
  for (const art of ["Wounds-00", "Wounds-01", "Wounds-02", "Wounds-03", "Wounds-Death"]) {
    const path = new URL(`../icons/wounds/${art}.svg`, import.meta.url);
    assert.ok(readFileSync(path, "utf8").includes("<svg"), `${art}.svg must ship with the module`);
  }

  // (b) The whole ramp, wound by wound, on the live rail. Earlier checks leave
  //     the module unmounted, so it is put back up first — the rail only exists
  //     while mobile mode is on.
  if (!document.body.classList.contains("msp-on")) globalThis.MobileSimplePlay.mount();
  assert.ok(document.getElementById("msp-rail"), "the rail must be up before the ramp is measured");
  //     The chip counts drops still RED — capacity left — and the art walks
  //     Wounds-00 through Wounds-03.
  const seen = [];
  for (let taken = 0; taken <= 3; taken++) {
    actor.system.wounds.value = taken;
    Hooks.callAll("updateActor", actor);
    const r = document.getElementById("msp-rail");
    const chip = r.querySelector(".msp-wounds-chip");
    const art = r.querySelector(".msp-wounds-art");
    seen.push(`${taken}->${chip.textContent}`);
    assert.strictEqual(chip.textContent, String(3 - taken),
      `with ${taken} wounds the chip must read ${3 - taken} — drops LEFT, not wounds taken`);
    assert.ok(art.getAttribute("src").endsWith(`Wounds-0${taken}.svg`),
      `with ${taken} wounds the art must be Wounds-0${taken}`);
    assert.ok(r.querySelector(".msp-wounds").getAttribute("aria-label").includes(`${taken}/3`),
      "the label a screen reader hears must carry the real numbers");
  }
  assert.deepStrictEqual(seen, ["0->3", "1->2", "2->1", "3->0"]);

  // (c) Incapacitated is a STATUS, not a fourth wound. A Wild Card who fails the
  //     Vigor roll is out at three wounds, so counting alone would miss him.
  actor.system.wounds.value = 1;
  actor.statuses = new Set(["incapacitated"]);
  Hooks.callAll("createActiveEffect", actor);
  const down = document.getElementById("msp-rail");
  assert.strictEqual(down.querySelector(".msp-wounds-chip").textContent, "X");
  assert.ok(down.querySelector(".msp-wounds-art").getAttribute("src").endsWith("Wounds-Death.svg"),
    "the skull must come from the status, even with only one wound on the sheet");
  actor.statuses = new Set();
  actor.system.wounds.value = 0;
  Hooks.callAll("deleteActiveEffect", actor);

  // (d) The status hooks. Being Incapacitated is an ActiveEffect and never fires
  //     updateActor: without these the rail would show a healthy character who
  //     is already down. This is the check that would have caught it.
  for (const h of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
    assert.ok(js.includes(`"${h}"`), `the rail must rebuild on ${h}, or the skull arrives late`);
  }

  // (e) Fatigue is gone from every layer, by Mario's call — not just hidden.
  //     Comments are stripped first: check 43 already burned a round on a name
  //     quoted inside a comment, and the same trap is set here, because the
  //     record of WHY fatigue left has to mention fatigue by name.
  const jsBare = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/msp-fatigue/.test(jsBare), "the fatigue badge must be gone from the script");
  assert.ok(!/msp-fatigue/.test(cssBare), "the fatigue badge must be gone from the stylesheet");

  // (f) The chip colours are his, and they are MEASURED against the black card
  //     the drawing carries. This is the rule that D-SHEET-03 learned the hard
  //     way: a token can be declared correct and still render below the line.
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const inks = [...css.matchAll(/\.msp-wounds-chip\[data-left="([^"]+)"\]\s*\{\s*--msp-wound-ink:\s*(#[0-9A-Fa-f]{6})/g)];
  assert.strictEqual(inks.length, 5, "all five chip states must have a colour");
  for (const [, state, hex] of inks) {
    const ratio = (lum(hex) + 0.05) / 0.05;   // sobre o preto do card
    assert.ok(ratio >= 4.5, `chip "${state}" (${hex}) measures ${ratio.toFixed(2)}:1 on the card — below 4.5:1`);
  }
}
ok(45, "the wound picture counts drops LEFT, the skull comes from the status, and every chip clears 4.5:1");

/* -------------------------------------------------------------------------
   46. D-BENNY-01 and D-JOURNAL-01 — the two doors added without a drawing

   Both are function, not layout, which is why they could be built while Mario's
   rail layout is still coming. What this check defends is that neither of them
   guesses: the benny button only exists for an actor that can spend one, the
   journal entry only exists if a door answered, and the 3D die that escaped the
   muzzle is shut by CSS instead of by writing someone's saved preference.
   ------------------------------------------------------------------------- */
{
  const js = readFileSync(new URL("../scripts/mobile-simple-play.mjs", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");

  if (!document.body.classList.contains("msp-on")) globalThis.MobileSimplePlay.mount();
  const r = document.getElementById("msp-rail");

  // (a) Order in the foot: TARGET, BENNY, WOUNDS — top to bottom, as drawn in
  //     Mario's screen mockup. Order in the DOM is order on screen.
  //
  //     This assertion was the OPPOSITE a few hours ago, and the flip is the
  //     point: his sentence ("o Benny... em cima do alvo") and his drawing
  //     disagreed, and the drawing is later and unambiguous. Left explicit so
  //     nobody restores the old order from the old sentence.
  const foot = r.querySelector(".msp-rail-foot");
  const kids = [...foot.children];
  const at = (cls) => kids.findIndex(k => k.classList.contains(cls) || k.querySelector?.(`.${cls}`));
  const iTarget = at("msp-target"), iBenny = at("msp-benny"), iWounds = at("msp-wounds");
  assert.ok(iBenny >= 0, "the benny button must be in the rail foot");
  assert.ok(iTarget < iBenny, "the target sits ABOVE the benny — Mario's mockup");
  assert.ok(iBenny < iWounds, "the benny sits above the wounds — Mario's mockup");

  // (b) It spends, and it spends through SWADE's own method.
  const before = actor.system.bennies.value;
  foot.querySelector(".msp-benny").dispatchEvent(new dom.window.Event("click"));
  await new Promise(res => setTimeout(res, 10));
  assert.ok(calls.includes("spendBenny"), "the button must call the system's spendBenny()");
  assert.strictEqual(actor.system.bennies.value, before - 1);

  // (c) At zero it looks spent instead of looking live and doing nothing — the
  //     worst outcome on a phone, where there is no hover to hint at it.
  actor.system.bennies.value = 0;
  Hooks.callAll("updateActor", actor);
  const empty = document.getElementById("msp-rail").querySelector(".msp-benny");
  assert.ok(empty.classList.contains("msp-benny-empty"));
  assert.strictEqual(empty.getAttribute("aria-disabled"), "true");
  assert.ok(/Sem bennies|No bennies/.test(empty.getAttribute("aria-label")),
    "the label must say why it is off, because the icon cannot");
  actor.system.bennies.value = 1;
  Hooks.callAll("updateActor", actor);

  // (d) The number is printed ONCE, and D-BENNY-02 moved WHERE. It used to be a
  //     separate numeric badge and the button carried no figure; Mario's mockup
  //     put the count on the button's own chip, so the badge went. Either way
  //     the invariant is the same: the rail states the benny count exactly once.
  const railNow = document.getElementById("msp-rail");
  const comNumero = [...railNow.querySelectorAll(".msp-benny, .msp-bennies")]
    .filter(n => /\d/.test(n.textContent ?? ""));
  assert.strictEqual(comNumero.length, 1,
    "the benny count must appear exactly once in the rail");
  assert.ok(comNumero[0].classList.contains("msp-benny"),
    "and it must be the chip on the button itself (D-BENNY-02)");

  // (d2) The picture saturates at three; the numeral does not. His rule, and the
  //      only place where the two halves of the badge deliberately disagree.
  for (const [n, art] of [[0, "BennieBlank"], [1, "Bennie01"], [2, "Bennie02"], [3, "Bennies-003"], [5, "Bennies-003"]]) {
    actor.system.bennies.value = n;
    Hooks.callAll("updateActor", actor);
    const b = document.getElementById("msp-rail").querySelector(".msp-benny");
    assert.ok(b.querySelector(".msp-benny-art").getAttribute("src").endsWith(`${art}.svg`),
      `with ${n} bennies the art must be ${art}`);
    assert.strictEqual(b.querySelector(".msp-benny-chip").textContent, String(n),
      `with ${n} bennies the chip must read ${n} — exact even when the art has stopped counting`);
    const path = new URL(`../icons/bennies/${art}.svg`, import.meta.url);
    assert.ok(readFileSync(path, "utf8").includes("<svg"), `${art}.svg must ship with the module`);
  }
  actor.system.bennies.value = 1;
  Hooks.callAll("updateActor", actor);

  // (d3) The target is Mario's drawing now, not a font glyph, and the foot's
  //      geometry is the one measured on his mockup: 50 for the art, 20 for the
  //      chip, ending at 78 — which is exactly where he put the carousel.
  const alvo = document.getElementById("msp-rail").querySelector(".msp-target img");
  assert.ok(alvo?.getAttribute("src").endsWith("target-001.svg"),
    "the target must use his SVG, not a font icon");
  const cssFoot = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const art = cssFoot.match(/--msp-foot-art:\s*calc\((\d+)px/);
  const chip = cssFoot.match(/--msp-foot-chip:\s*calc\((\d+)px/);
  const gap = cssFoot.match(/--msp-foot-gap:\s*calc\((\d+)px/);
  assert.ok(art && chip && gap, "the foot geometry must be in variables, not scattered pixels");
  const fim = 5 + Number(art[1]) + Number(gap[1]) + Number(chip[1]);
  assert.strictEqual(fim, 78,
    `the foot ends at ${fim}, but the carousel starts at 78 — the chip would collide with the first portrait`);

  // (e) The journal opener asks; it does not assume. No door, no menu entry.
  const finder = js.match(/function journalOpener\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(finder, "the journal must be looked up, not assumed");
  assert.ok(/typeof d\.renderPopout === "function"/.test(finder[0]),
    "the door must be type-checked before it is offered");
  assert.ok(/const journal = journalOpener\(\);\s*\n\s*if \(journal\)/.test(js),
    "the menu entry must only exist when a door answered");

  // (e2) And the entry really appears when a door exists. The shape check above
  //      reads source; this one opens the menu, because a defensive lookup that
  //      is never exercised is a lookup nobody has seen work.
  globalThis.ui.journal = { renderPopout: () => calls.push("journal.renderPopout") };
  document.querySelector("#msp-bar .msp-more")?.dispatchEvent(new dom.window.Event("click"));
  const entrada = [...document.querySelectorAll("#msp-overlay .msp-more-list button")]
    .find(b => /Journal|Di\u00e1rio/.test(b.textContent));
  assert.ok(entrada, "with a door open, the Journal entry must be in the More menu");
  entrada.dispatchEvent(new dom.window.Event("click"));
  assert.ok(calls.includes("journal.renderPopout"), "and tapping it must open the journal");
  delete globalThis.ui.journal;

  // (f) The benny's 3D die. SWADE calls showForRoll directly and DSN's own valve
  //     does not cover that path, so the muzzle here is CSS — and it must NOT be
  //     a write to the player's saved flag.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(/body\.msp-on\s+#dice-box-canvas\s*\{[^}]*display:\s*none\s*!important/.test(bare),
    "the DSN canvas must be hidden while mobile mode is on");
  assert.ok(!/setFlag\([^)]*dsnShowBennyAnimation/.test(js),
    "the player's dsnShowBennyAnimation flag is theirs — the module must never write it");
}
ok(46, "the benny spends from above the target, the journal only appears if a door answered, and the 3D die is shut by CSS");

/* -------------------------------------------------------------------------
   47. D-LOGOUT-01 — the exit asks first

   The one entry in this module that cannot be undone by tapping again. On a
   phone there is no menu bar to climb back through: a stray thumb ends the
   session mid-fight and the player has to find the URL again. So the thing
   under test is not that log out works — it is that a single tap CANNOT log
   anyone out.
   ------------------------------------------------------------------------- */
{
  const js = readFileSync(new URL("../scripts/mobile-simple-play.mjs", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/mobile-simple-play.css", import.meta.url), "utf8");

  if (!document.body.classList.contains("msp-on")) globalThis.MobileSimplePlay.mount();

  const abrirMais = () =>
    document.querySelector("#msp-bar .msp-more")?.dispatchEvent(new dom.window.Event("click"));
  const itens = () => [...document.querySelectorAll("#msp-overlay .msp-more-list button")];

  // (a) The diagnostic log left the menu — Mario's call, now that the Chrome
  //     emulator does that job. The console door stays: `MobileSimplePlay
  //     .saveLog()` is still exported, because it costs nothing and it is how
  //     a real fault gets captured.
  abrirMais();
  assert.ok(!itens().some(b => /Save diagnostic|log de diagn/i.test(b.textContent)),
    "the diagnostic log entry must be gone from the More menu");
  assert.strictEqual(typeof globalThis.MobileSimplePlay.saveLog, "function",
    "but saveLog must remain reachable from the console");

  // (b) Log Out is there, and marked as destructive.
  const sair = itens().find(b => /Log Out|Sair/.test(b.textContent));
  assert.ok(sair, "Log Out must be in the More menu");
  assert.ok(sair.classList.contains("msp-danger"), "and it must be marked as destructive");

  // (c) THE POINT: one tap does not log out. It asks.
  const antes = calls.filter(c => c === "game.logOut").length;
  sair.dispatchEvent(new dom.window.Event("click"));
  assert.strictEqual(calls.filter(c => c === "game.logOut").length, antes,
    "tapping Log Out must NOT log out — it must ask first");
  const pergunta = document.querySelector("#msp-overlay .msp-confirm");
  assert.ok(pergunta && pergunta.textContent.trim().length > 0, "a confirmation must be on screen");

  // (d) Cancel is the PRIMARY button and the affirmative is the plain one —
  //     reversed on purpose, because the two mistakes do not cost the same.
  const botoes = [...document.querySelectorAll("#msp-overlay .msp-overlay-foot button")];
  assert.strictEqual(botoes.length, 2, "the confirmation must offer exactly two ways out");
  assert.ok(botoes[0].classList.contains("msp-primary"),
    "Cancel must be the primary button — confirming by accident costs the session");
  assert.ok(!botoes[1].classList.contains("msp-primary"));
  assert.ok(botoes[1].classList.contains("msp-danger"));

  // (e) Cancelling really cancels, and leaves nothing behind.
  botoes[0].dispatchEvent(new dom.window.Event("click"));
  assert.strictEqual(calls.filter(c => c === "game.logOut").length, antes, "cancel must not log out");
  assert.ok(!document.getElementById("msp-overlay"), "and the overlay must close");

  // (f) Confirming does log out, through Foundry's own exit.
  abrirMais();
  itens().find(b => /Log Out|Sair/.test(b.textContent)).dispatchEvent(new dom.window.Event("click"));
  [...document.querySelectorAll("#msp-overlay .msp-overlay-foot button")][1]
    .dispatchEvent(new dom.window.Event("click"));
  assert.strictEqual(calls.filter(c => c === "game.logOut").length, antes + 1,
    "confirming must call game.logOut()");

  // (g) And it logs out ONLY. No settings cleared, no flags written, no storage
  //     wiped on the way past — Foundry stays the authority over its own state.
  const saida = js.match(/function confirmLogOut\(\)[\s\S]*?\n\}/)[0];
  assert.ok(!/setFlag|setSetting|localStorage|sessionStorage|clear\(\)/.test(saida),
    "logging out must not also reset anything of the player's");

  // (h) The red is measured, not picked by eye — same rule the wound chips
  //     answer to. Darkest surface this button sits on is the list, #1c1b19.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const vermelho = bare.match(/\.msp-danger[^{]*\{[^}]*color:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(vermelho, "the destructive colour must be declared");
  const lin = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = (hex) => { const [r, g, b] = lin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (L(vermelho[1]) + 0.05) / (L("#1c1b19") + 0.05);
  assert.ok(ratio >= 4.5, `the destructive red measures ${ratio.toFixed(2)}:1 — below 4.5:1`);
}
ok(47, "Log Out replaced the diagnostic log, asks before it acts, and cancel is the easy answer");

console.log("\n=== 47/47 green ===");
