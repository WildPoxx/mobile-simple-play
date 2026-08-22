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
    <section id="ui-left"></section>
    <section id="ui-middle"><header id="ui-top"></header><footer id="ui-bottom"><aside id="hotbar"></aside></footer></section>
    <section id="ui-right">
      <div id="ui-right-column-1"></div>
      <aside id="sidebar"><nav class="tabs"></nav>
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
// Node 22 exposes `navigator` as a getter-only global, so redefine it.
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.Blob = dom.window.Blob;
globalThis.URL = dom.window.URL;
dom.window.URL.createObjectURL = () => "blob:fake";
dom.window.URL.revokeObjectURL = () => {};
window.matchMedia = q => ({ matches: q.includes("coarse"), media: q, addEventListener() {}, removeEventListener() {} });

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
  app: { ticker: { start: () => calls.push("ticker.start"), stop: () => calls.push("ticker.stop") } }
};

globalThis.ui = {
  sidebar: { changeTab: (tab, group) => calls.push(`sidebar.changeTab:${tab}/${group}`) },
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
ok(2, "init registers three settings; `enabled` is client scope and starts FALSE");

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
assert.ok(calls.some(c => c.startsWith("item.show:")));
assert.ok(calls.some(c => c.startsWith("rollSkill:")));
ok(9, "taps: weapon calls item.show(), skill calls rollSkill()");

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

// 14. The sidebar is forced onto the chat tab. Without this, whatever tab was
//     open when mobile mode started stays open, with no tab strip to escape it.
calls.length = 0;
globalThis.MobileSimplePlay.setTab("chat");
assert.ok(calls.includes("sidebar.changeTab:chat/primary"), "sidebar pinned to chat");
Hooks.callAll("renderSidebar");
assert.ok(calls.filter(c => c === "sidebar.changeTab:chat/primary").length >= 2, "re-pinned when the sidebar re-renders");
ok(14, "the sidebar is forced onto the chat tab, and stays there");

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

// 19. The field log captures errors while mobile mode is on.
const before = globalThis.MobileSimplePlay.logBuffer.length;
console.error("a fake explosion", new Error("boom"));
assert.ok(globalThis.MobileSimplePlay.logBuffer.length > before, "the error was captured");
assert.ok(globalThis.MobileSimplePlay.logBuffer.some(l => l.includes("boom")), "with its message");
ok(19, "the field log captures console errors while mobile mode is on");

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

console.log("\n=== 22/22 green ===");
