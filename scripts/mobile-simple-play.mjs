/**
 * Mobile Simple Play — v0.1.6
 *
 * SAFETY PRINCIPLE OF THIS VERSION — read this before touching anything:
 *
 *   THE MODULE IS BORN INERT. While the `enabled` setting is false — and it is
 *   false by default — it adds no DOM node, swaps no core class, patches no
 *   global and registers no listener. The only thing it does on load is declare
 *   three settings.
 *
 *   `enabled` is "client" scope: it lives in the localStorage of THAT browser.
 *   Turning it on from a phone changes nothing for the GM, for the other
 *   players, or for the same player on another device.
 *
 *   Everything that runs afterwards is wrapped in try/catch. A bug of ours
 *   becomes a console line, never a world that will not open.
 *
 *   This is why the log capture (§ Field log) starts at mount() and not at
 *   init(): patching console while the module is off would break the rule
 *   above. The cost is that errors thrown before mobile mode is turned on are
 *   not captured. That is a deliberate trade, not an oversight.
 *
 * ARCHITECTURAL CHOICE: v0.1 IS CSS-FIRST.
 *   We do not replace CONFIG.ui.chat or any other core class. We toggle a
 *   <body> class and append elements of OUR OWN. Less powerful, and far safer
 *   for a first version that runs in a live campaign.
 */

const MOD = "mobile-simple-play";
const VERSION = "0.1.6";
const BODY_CLASS = "msp-on";

/** Skills placed on the rail when the player has configured nothing.
 *  The five SWADE core skills plus the two most-used combat ones.
 *  Both English and Portuguese names are listed because the compendium
 *  language varies from table to table. */
const DEFAULT_SKILLS = [
  "Athletics", "Atletismo",
  "Common Knowledge", "Conhecimentos Gerais", "Conhecimento Comum",
  "Notice", "Perceber", "Notar",
  "Persuasion", "Persuasão", "Persuasao",
  "Stealth", "Furtividade",
  "Fighting", "Lutar", "Luta",
  "Shooting", "Atirar", "Tiro"
];

/** Foundry's own "your window is too small" notices. On a phone they are always
 *  true and never actionable, so mobile mode suppresses them. */
const RESOLUTION_KEYS = ["ERROR.RESOLUTION.Screen", "ERROR.RESOLUTION.Scale", "ERROR.RESOLUTION.Window"];

/** Registry of everything we create or patch, so we can tear it all down. */
const ui_ = {
  rail: null, bar: null, overlay: null, writeClose: null,
  hooks: [], capture: null, notify: null, logWatch: null
};

/* -------------------------------------------------- */
/*  Small utilities                                    */
/* -------------------------------------------------- */

const log = (...a) => console.log(`${MOD} |`, ...a);
const warn = (...a) => console.warn(`${MOD} |`, ...a);

/**
 * Localize with a guaranteed English fallback.
 * If the key is missing from every loaded language file, Foundry returns the
 * key itself — which would show up on screen as "MSP.Tab.Chat". We never let
 * that happen: the English text passed here is the last line of defence.
 */
function t(key, fallback) {
  try {
    const out = game.i18n?.localize?.(key);
    return (!out || out === key) ? fallback : out;
  } catch {
    return fallback;
  }
}

/** Wraps anything of ours. Nothing in here may take the world down. */
function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    warn(`failure in "${label}" — the module carries on, Foundry carries on.`, err);
    return undefined;
  }
}

function setting(key) {
  try {
    return game.settings.get(MOD, key);
  } catch {
    return undefined;
  }
}

function isTouch() {
  return safe("isTouch", () => window.matchMedia?.("(pointer: coarse)")?.matches === true) ?? false;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

/** The player's actor. No canvas, no token: it is the assigned character. */
function myActor() {
  return safe("myActor", () => game.user?.character ?? null) ?? null;
}

/* -------------------------------------------------- */
/*  Field log — so a phone test produces evidence      */
/* -------------------------------------------------- */

const LOG_MAX = 500;
const logBuffer = [];

function pushLog(kind, args) {
  try {
    const stamp = new Date().toISOString().slice(11, 23);
    const text = args.map(a => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
      if (a && typeof a === "object") {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    }).join(" ");
    logBuffer.push(`[${stamp}] ${kind}  ${text}`);
    if (logBuffer.length > LOG_MAX) logBuffer.shift();
  } catch {
    // Logging must never be the thing that breaks. Swallow and move on.
  }
}

/**
 * Wrapping console.warn/error costs something visible: DevTools then reports
 * EVERY warning in the whole application as coming from this file, because we
 * are the last frame before the console call. That is a real nuisance while
 * hunting somebody else's bug, so capture is now OFF by default and turned on
 * only when a diagnostic log is actually wanted.
 */
function startCapture() {
  if (ui_.capture) return;
  if (setting("capture") !== true) {
    pushLog("INFO ", ["console capture is OFF (turn it on in settings before reproducing a bug)"]);
    return;
  }
  safe("start log capture", () => {
    const original = { warn: console.warn, error: console.error };
    console.warn = (...a) => { pushLog("WARN ", a); original.warn.apply(console, a); };
    console.error = (...a) => { pushLog("ERROR", a); original.error.apply(console, a); };
    const onError = ev => pushLog("UNCAUGHT", [ev.message, `${ev.filename}:${ev.lineno}:${ev.colno}`, ev.error]);
    const onReject = ev => pushLog("REJECTED", [ev.reason]);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    ui_.capture = { original, onError, onReject };
    pushLog("INFO ", [`Mobile Simple Play ${VERSION} — capture started`]);
  });
}

function stopCapture() {
  safe("stop log capture", () => {
    if (!ui_.capture) return;
    console.warn = ui_.capture.original.warn;
    console.error = ui_.capture.original.error;
    window.removeEventListener("error", ui_.capture.onError);
    window.removeEventListener("unhandledrejection", ui_.capture.onReject);
    ui_.capture = null;
  });
}

/** The header that makes a log readable three days later. */
function logHeader() {
  const g = safe("log header", () => ({
    foundry: game.version ?? game.release?.version ?? "?",
    system: `${game.system?.id ?? "?"} ${game.system?.version ?? ""}`,
    user: game.user?.name ?? "?",
    actor: myActor()?.name ?? "(none)",
    modules: game.modules ? [...game.modules].filter(m => m.active).length : "?"
  })) ?? {};
  return [
    "=== Mobile Simple Play — field log ===",
    `module          ${VERSION}`,
    `foundry         ${g.foundry}`,
    `system          ${g.system}`,
    `user / actor    ${g.user} / ${g.actor}`,
    `active modules  ${g.modules}`,
    `viewport        ${window.innerWidth}x${window.innerHeight}  dpr ${window.devicePixelRatio}`,
    `screen          ${window.screen?.width}x${window.screen?.height}`,
    `touch           ${isTouch()}`,
    `canvas          ${canvas?.ready ? "ready" : "not ready"}`,
    `user agent      ${navigator.userAgent}`,
    `captured        ${logBuffer.length} line(s), newest last`,
    "======================================",
    ""
  ].join("\n");
}

/**
 * Save the captured log. Tries a real file download first, and always copies to
 * the clipboard as well — on a phone, one of the two paths usually survives.
 */
async function saveLog() {
  const text = logHeader() + logBuffer.join("\n") + "\n";
  let downloaded = false;
  let copied = false;

  safe("download log", () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = el("a", { href: url, download: `msp-log-${stamp}.txt` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => safe("revoke url", () => URL.revokeObjectURL(url)), 10000);
    downloaded = true;
  });

  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    // Clipboard needs a secure context and a user gesture; not always granted.
  }

  const how = downloaded && copied ? t("MSP.Log.Both", "Log saved to your downloads and copied to the clipboard.")
    : downloaded ? t("MSP.Log.Saved", "Log saved to your downloads.")
    : copied ? t("MSP.Log.Copied", "Log copied to the clipboard.")
    : t("MSP.Log.Failed", "Could not save the log automatically.");
  safe("log notice", () => ui.notifications?.info?.(how));
  if (!downloaded && !copied) safe("log to console", () => console.log(text));
}

/* -------------------------------------------------- */
/*  Foundry's window-size notices                      */
/* -------------------------------------------------- */

/**
 * On a phone, Foundry permanently complains that the window is smaller than
 * 1024x768. It is right, it is unfixable, and it covers the chat. While mobile
 * mode is on we suppress it — the notice, not the condition.
 */
function silenceResolutionNotices() {
  safe("silence resolution notices", () => {
    const notes = ui.notifications;
    if (!notes || ui_.notify) return;

    // 1. Stop future ones. `#validateResolution` re-fires on every resize, and
    //    a mobile browser resizes constantly as the URL bar hides and shows.
    //    We remember the exact property descriptor we are shadowing, so that
    //    unmount puts back what was there — whether that was an inherited
    //    prototype method (Foundry's own) or another module's override. Simply
    //    deleting the property would destroy the latter.
    const prior = Object.getOwnPropertyDescriptor(notes, "notify") ?? null;
    const original = notes.notify.bind(notes);
    ui_.notify = { prior, original };
    notes.notify = function(message, type, options) {
      if (typeof message === "string" && RESOLUTION_KEYS.includes(message)) return -1;
      return original(message, type, options);
    };

    // 2. Remove the one already on screen. We match on the localized text up to
    //    its first placeholder, so this works in any language.
    const prefixes = RESOLUTION_KEYS.map(key => {
      const s = t(key, "");
      const cut = s.indexOf("{");
      return (cut > 12 ? s.slice(0, cut) : s.slice(0, 48)).trim();
    }).filter(p => p.length > 12);
    for (const node of document.querySelectorAll("#notifications .notification")) {
      const txt = (node.textContent ?? "").trim();
      if (prefixes.some(p => txt.startsWith(p))) node.remove();
    }
  });
}

function restoreResolutionNotices() {
  safe("restore resolution notices", () => {
    if (!ui_.notify) return;
    if (ui_.notify.prior) Object.defineProperty(ui.notifications, "notify", ui_.notify.prior);
    else delete ui.notifications.notify;
    ui_.notify = null;
  });
}

/* -------------------------------------------------- */
/*  Long press — reveals the name of the icon          */
/* -------------------------------------------------- */

function attachLongPress(node, label) {
  let timer = null;
  const show = () => {
    const tip = el("div", { class: "msp-tip", text: label });
    node.append(tip);
    setTimeout(() => tip.remove(), 1600);
  };
  const start = () => {
    clearTimeout(timer);
    timer = setTimeout(show, 450);
  };
  const cancel = () => clearTimeout(timer);
  node.addEventListener("pointerdown", start);
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointerleave", cancel);
  node.addEventListener("pointercancel", cancel);
}

/* -------------------------------------------------- */
/*  Action rail                                        */
/* -------------------------------------------------- */

function chosenSkills(actor) {
  const raw = (setting("skills") ?? "").trim();
  const wanted = raw
    ? raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_SKILLS.map(s => s.toLowerCase());
  const skills = actor.items.filter(i => i.type === "skill");
  const picked = skills.filter(s => wanted.includes(s.name.trim().toLowerCase()));
  // No match at all? Better to show the first few than nothing.
  return (picked.length ? picked : skills).slice(0, 8);
}

function favouriteItems(actor) {
  return actor.items.filter(i => {
    const fav = i.system?.favorite === true;
    const kind = ["weapon", "power", "consumable", "gear", "action", "shield"].includes(i.type);
    return fav && kind;
  });
}

function railButton({ img, label, cls, icon, onClick }) {
  const btn = el("button", {
    type: "button",
    class: `msp-slot ${cls ?? ""}`,
    "aria-label": label,
    onclick: (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      safe(`action "${label}"`, onClick);
    }
  });
  if (img) btn.append(el("img", { src: img, alt: "" }));
  else btn.append(el("i", { class: icon ?? "fa-solid fa-dice-d20" }));
  attachLongPress(btn, label);
  return btn;
}

function buildRail() {
  const actor = myActor();
  const rail = el("nav", { id: "msp-rail", "aria-label": t("MSP.Rail.Label", "Actions") });

  if (!actor) {
    rail.append(el("div", { class: "msp-empty", text: "—" }));
    return rail;
  }

  const top = el("div", { class: "msp-rail-top" });

  // FAVOURITE WEAPONS AND ITEMS — at the top, as in Mario's mockup.
  for (const item of favouriteItems(actor)) {
    top.append(railButton({
      img: item.img,
      label: item.name,
      cls: "msp-item",
      onClick: () => item.show?.()
    }));
  }

  if (top.childElementCount) top.append(el("hr", { class: "msp-div" }));

  // SKILLS
  for (const skill of chosenSkills(actor)) {
    top.append(railButton({
      img: skill.img,
      label: skill.name,
      cls: "msp-skill",
      onClick: () => actor.rollSkill?.(skill.id, {})
    }));
  }

  rail.append(top);

  // FOOT OF THE RAIL: status (read-only) and targeting.
  const foot = el("div", { class: "msp-rail-foot" });
  foot.append(buildStatusBadges(actor));
  foot.append(railButton({
    label: t("MSP.Target.Label", "Target"),
    cls: "msp-target",
    icon: "fa-solid fa-crosshairs",
    onClick: openTargetPicker
  }));
  rail.append(foot);

  return rail;
}

function buildStatusBadges(actor) {
  const box = el("div", { class: "msp-status" });
  const add = (label, value, cls) => {
    box.append(el("div", { class: `msp-badge ${cls}`, "aria-label": label, text: String(value) }));
  };
  safe("status badges", () => {
    const sys = actor.system ?? {};
    const w = sys.wounds;
    const f = sys.fatigue;
    const b = sys.bennies;
    if (w) add(t("MSP.Status.Wounds", "Wounds"), `${w.value ?? 0}/${w.max ?? 0}`, "msp-wounds");
    if (f) add(t("MSP.Status.Fatigue", "Fatigue"), `${f.value ?? 0}/${f.max ?? 0}`, "msp-fatigue");
    if (b) add(t("MSP.Status.Bennies", "Bennies"), `${b.value ?? 0}`, "msp-bennies");
  });
  return box;
}

/* -------------------------------------------------- */
/*  Target picking — works WITH and WITHOUT the canvas */
/* -------------------------------------------------- */

const DISPOSITION_ORDER = { "-1": 0, "-2": 1, "0": 2, "1": 3 };

function sceneTokens() {
  return safe("sceneTokens", () => {
    const scene = game.scenes?.active ?? game.scenes?.viewed ?? null;
    if (!scene) return [];
    return [...scene.tokens].sort((a, b) => {
      const da = DISPOSITION_ORDER[String(a.disposition)] ?? 9;
      const db = DISPOSITION_ORDER[String(b.disposition)] ?? 9;
      return da - db || String(a.name).localeCompare(String(b.name));
    });
  }) ?? [];
}

function currentTargetIds() {
  return safe("current targets", () => new Set([...(game.user?.targets ?? [])].map(tok => tok.id))) ?? new Set();
}

function applyTargets(ids) {
  safe("set target", () => {
    const list = [...ids];
    if (canvas?.ready && canvas?.tokens) {
      canvas.tokens.setTargets(list, { mode: "replace" });
    } else {
      // No canvas: the half that matters is pure socket.
      game.user.broadcastActivity({ targets: list });
    }
  });
}

function openTargetPicker() {
  closeOverlay();
  const chosen = new Set(currentTargetIds());
  const list = el("div", { class: "msp-list" });

  for (const tok of sceneTokens()) {
    const row = el("button", {
      type: "button",
      class: `msp-row${chosen.has(tok.id) ? " is-on" : ""}`,
      onclick: () => {
        if (chosen.has(tok.id)) chosen.delete(tok.id);
        else chosen.add(tok.id);
        row.classList.toggle("is-on");
        applyTargets(chosen);
      }
    });
    row.append(el("img", { src: tok.texture?.src ?? tok.actor?.img ?? "", alt: "" }));
    row.append(el("span", { class: "msp-row-name", text: tok.name ?? "—" }));
    row.append(el("i", { class: "msp-check fa-solid fa-crosshairs" }));
    list.append(row);
  }

  if (!list.childElementCount) {
    list.append(el("p", { class: "msp-empty", text: t("MSP.Target.Empty", "No tokens in this scene.") }));
  }

  openOverlay(t("MSP.Target.Title", "Target"), list, [
    { label: t("MSP.Common.Clear", "Clear"), onClick: () => { chosen.clear(); applyTargets(chosen); closeOverlay(); } },
    { label: t("MSP.Common.Close", "Close"), onClick: closeOverlay, primary: true }
  ]);
}

/* -------------------------------------------------- */
/*  Generic overlay                                    */
/* -------------------------------------------------- */

function openOverlay(title, content, buttons = []) {
  closeOverlay();
  const foot = el("footer", { class: "msp-overlay-foot" });
  for (const b of buttons) {
    foot.append(el("button", {
      type: "button",
      class: b.primary ? "msp-primary" : "",
      text: b.label,
      onclick: () => safe(`button "${b.label}"`, b.onClick)
    }));
  }
  const box = el("div", { class: "msp-overlay-box" },
    el("header", { class: "msp-overlay-head", text: title }),
    el("div", { class: "msp-overlay-body" }, content),
    buttons.length ? foot : null
  );
  const back = el("div", {
    id: "msp-overlay",
    onclick: (ev) => { if (ev.target?.id === "msp-overlay") closeOverlay(); }
  }, box);
  document.body.append(back);
  ui_.overlay = back;
}

function closeOverlay() {
  ui_.overlay?.remove();
  ui_.overlay = null;
}

/* -------------------------------------------------- */
/*  The single bottom bar                              */
/* -------------------------------------------------- */

/**
 * Pin Foundry's sidebar: EXPANDED, and on the chat tab.
 *
 * Both halves matter, and the first one is not cosmetic. Foundry documents the
 * rule in ChatLog#_toggleNotifications:
 *
 *   "if the sidebar is expanded, and the chat log is the active tab, embed chat
 *    input into it. Otherwise, embed chat input into the notifications area."
 *
 * The notifications area lives in #ui-right-column-1 — which mobile mode hides.
 * So with the sidebar COLLAPSED, Foundry quietly moves the message field into an
 * element we made invisible, and the player is left with a chat they cannot
 * write into and a field that appears to be broken. Keeping the sidebar expanded
 * keeps the log and the input where our CSS expects them.
 *
 * The tab half is the older fix: whichever tab happened to be open when mobile
 * mode started stayed open, and we hide the tab strip, so there was no way back.
 */
function pinSidebar() {
  safe("pin sidebar", () => {
    if (ui.sidebar?.expanded === false) ui.sidebar.expand?.();
    ui.sidebar?.changeTab?.("chat", "primary");
  });
}

function setTab(tab) {
  safe("switch tab", () => {
    document.body.dataset.mspTab = tab;
    for (const b of ui_.bar?.querySelectorAll("[data-msp-tab]") ?? []) {
      b.classList.toggle("is-active", b.dataset.mspTab === tab);
    }
    // Leaving the map saves battery: stop the PIXI animation clock.
    safe("PIXI ticker", () => {
      if (!canvas?.ready || !canvas.app?.ticker) return;
      if (tab === "map") canvas.app.ticker.start();
      else canvas.app.ticker.stop();
    });
    if (tab === "chat") { pinSidebar(); clearChatPip(); }
    else showChatForm(false);   // the writing field must not float over the map
  });
}

function tabButton(tab, icon, label) {
  const btn = el("button", {
    type: "button",
    class: "msp-tab",
    "data-msp-tab": tab,
    "aria-label": label,
    onclick: () => setTab(tab)
  }, el("i", { class: icon }));
  if (tab === "chat") btn.append(el("span", { class: "msp-pip", hidden: "hidden" }));
  return btn;
}

function buildBar() {
  const bar = el("nav", { id: "msp-bar", "aria-label": t("MSP.Bar.Label", "Navigation") });

  bar.append(tabButton("chat", "fa-solid fa-comments", t("MSP.Tab.Chat", "Chat")));
  if (safe("is the canvas on?", () => !game.settings.get("core", "noCanvas")) ?? false) {
    bar.append(tabButton("map", "fa-solid fa-map", t("MSP.Tab.Map", "Map")));
  }

  // The character button — an action, never "lit".
  const actor = myActor();
  const pc = el("button", {
    type: "button",
    id: "msp-pc",
    "aria-label": actor?.name ?? t("MSP.Bar.Character", "Character"),
    onclick: () => safe("open sheet", () => myActor()?.sheet?.render(true))
  });
  if (actor?.img) pc.append(el("img", { src: actor.img, alt: "" }));
  else pc.append(el("i", { class: "fa-solid fa-user" }));
  bar.append(pc);

  // "More" — write in chat, hotbar, save log, turn off.
  bar.append(el("button", {
    type: "button",
    class: "msp-more",
    "aria-label": t("MSP.More.Label", "More"),
    onclick: openMore
  }, el("i", { class: "fa-solid fa-ellipsis" })));

  return bar;
}

function openMore() {
  const writing = document.body.classList.contains("msp-writing");
  const box = el("div", { class: "msp-more-list" });

  box.append(el("button", {
    type: "button",
    text: writing ? t("MSP.More.StopWriting", "Close the message field")
                  : t("MSP.More.Write", "Write in chat"),
    onclick: () => { closeOverlay(); showChatForm(!writing); }
  }));
  box.append(el("button", {
    type: "button", text: t("MSP.More.Hotbar", "Hotbar"),
    onclick: () => { closeOverlay(); openHotbar(); }
  }));
  box.append(el("button", {
    type: "button", text: t("MSP.More.SaveLog", "Save diagnostic log"),
    onclick: () => { closeOverlay(); saveLog(); }
  }));
  box.append(el("button", {
    type: "button", text: t("MSP.More.Disable", "Turn off mobile mode"),
    onclick: () => { closeOverlay(); disableAndReload(); }
  }));

  openOverlay(t("MSP.More.Label", "More"), box, [
    { label: t("MSP.Common.Close", "Close"), onClick: closeOverlay, primary: true }
  ]);
}

/* -------------------------------------------------- */
/*  Writing in the chat                                */
/* -------------------------------------------------- */

/**
 * Show or hide Foundry's message field.
 * v0.1.1 could only ever open it, and nothing closed it again — it stayed on
 * top of the chat forever. It is a toggle now, it closes itself once a message
 * goes out, and it carries its own close button.
 */
function showChatForm(show) {
  safe("message field", () => {
    document.body.classList.toggle("msp-writing", show === true);
    if (!show) return;
    // Look for the form anywhere: Foundry relocates it between #chat and the
    // notifications area depending on sidebar state. pinSidebar() should keep
    // it inside #chat, but we do not want to depend on that alone.
    const form = document.querySelector("#chat .chat-form") ?? document.querySelector(".chat-form");
    form?.querySelector("textarea, input, [contenteditable='true'], .editor-content")?.focus?.();
    scrollChatToBottom();
  });
}

function scrollChatToBottom() {
  safe("scroll chat", () => {
    const scroll = document.querySelector("#chat .chat-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });
}

/**
 * Watch the chat log and scroll to the bottom whenever a card is added.
 *
 * v0.1.2 scrolled on the `createChatMessage` hook, and that was too early:
 * the hook fires when the DOCUMENT is created, while Foundry renders the card
 * through an async queue. We scrolled to the bottom of a log that did not yet
 * contain the new message, Foundry then appended it below the fold, and the
 * player saw nothing until a reload rebuilt the log from scratch.
 *
 * Watching the DOM removes the race: we react to the card ARRIVING, not to the
 * message being created.
 */
function watchChatLog() {
  if (ui_.logWatch) return;
  safe("watch chat log", () => {
    const log = document.querySelector("#chat .chat-log");
    if (!log || typeof MutationObserver !== "function") {
      pushLog("WARN ", ["chat log not found; live scrolling is OFF"]);
      return;
    }
    const observer = new MutationObserver(records => {
      let added = 0;
      for (const r of records) added += r.addedNodes.length;
      if (!added) return;
      pushLog("INFO ", [`chat log grew by ${added} node(s); scrolling to bottom`]);
      scrollChatToBottom();
    });
    observer.observe(log, { childList: true });
    ui_.logWatch = observer;
    pushLog("INFO ", [`watching the chat log (${log.childElementCount} card(s) at start)`]);
  });
}

function unwatchChatLog() {
  safe("unwatch chat log", () => {
    ui_.logWatch?.disconnect();
    ui_.logWatch = null;
  });
}

/* -------------------------------------------------- */
/*  Hotbar — our own overlay, not Foundry's bar        */
/* -------------------------------------------------- */

/**
 * Foundry's hotbar is a wide desktop strip; dropped onto a phone it lands on
 * top of the chat and fights the bottom bar. So we do not show the hotbar — we
 * show what is IN it, as a list, in the same overlay as everything else.
 */
function hotbarMacros() {
  return safe("read hotbar", () => {
    const slots = game.user?.hotbar ?? {};
    return Object.entries(slots)
      .map(([slot, id]) => ({ slot: Number(slot), macro: game.macros?.get(id) ?? null }))
      .filter(entry => entry.macro)
      .sort((a, b) => a.slot - b.slot);
  }) ?? [];
}

function openHotbar() {
  const list = el("div", { class: "msp-list" });

  for (const { slot, macro } of hotbarMacros()) {
    const row = el("button", {
      type: "button",
      class: "msp-row",
      onclick: () => {
        closeOverlay();
        safe(`macro "${macro.name}"`, () => macro.execute());
      }
    });
    row.append(el("img", { src: macro.img, alt: "" }));
    row.append(el("span", { class: "msp-row-name", text: macro.name }));
    row.append(el("span", { class: "msp-slot-num", text: String(slot) }));
    list.append(row);
  }

  if (!list.childElementCount) {
    list.append(el("p", { class: "msp-empty", text: t("MSP.Hotbar.Empty", "No macros on the hotbar.") }));
  }

  openOverlay(t("MSP.More.Hotbar", "Hotbar"), list, [
    { label: t("MSP.Common.Close", "Close"), onClick: closeOverlay, primary: true }
  ]);
}

/* -------------------------------------------------- */
/*  New-message pip                                    */
/* -------------------------------------------------- */

function flagChatPip() {
  if ((document.body.dataset.mspTab ?? "chat") === "chat") return;
  ui_.bar?.querySelector(".msp-pip")?.removeAttribute("hidden");
}

function clearChatPip() {
  ui_.bar?.querySelector(".msp-pip")?.setAttribute("hidden", "hidden");
}

/* -------------------------------------------------- */
/*  Foreign floating UI                                */
/* -------------------------------------------------- */

/** Elements Foundry itself puts at the top level. Anything else that turns up
 *  as a direct child of <body> came from a module, and may well be floating
 *  over our layout. */
const KNOWN_BODY_CHILDREN = new Set([
  "interface", "board", "hud", "notifications", "tooltip", "pause", "loading",
  "context-menu", "fps", "camera-views", "chat-notifications", "navigation",
  "msp-rail", "msp-bar", "msp-overlay", "msp-write-close"
]);

/**
 * Name the foreign furniture instead of hunting it in screenshots.
 *
 * Mobile mode hides Foundry's own chrome, but a module that appends a floating
 * button straight to <body> is out of reach of every layout rule we write. The
 * first one we met was Ginzzzu's "Show My Character", sitting on top of the
 * bottom bar; Mario found it by eye. With eighty-odd modules active there will
 * be others, so this writes them all into the diagnostic log at mount.
 */
function reportForeignChrome() {
  safe("survey body children", () => {
    const strangers = [];
    for (const node of document.body.children) {
      const id = node.id ?? "";
      if (KNOWN_BODY_CHILDREN.has(id)) continue;
      const tag = node.tagName.toLowerCase();
      if (["script", "template", "style", "link"].includes(tag)) continue;
      // Application windows and dialogs are legitimate and transient.
      if (node.classList.contains("application") || node.classList.contains("dialog")) continue;
      strangers.push(`${tag}${id ? "#" + id : ""}${node.className ? "." + String(node.className).trim().split(/\s+/).join(".") : ""}`);
    }
    if (strangers.length) {
      pushLog("INFO ", [`foreign body-level elements (${strangers.length}): ${strangers.join(" | ")}`]);
    } else {
      pushLog("INFO ", ["no foreign body-level elements"]);
    }
  });
}

/* -------------------------------------------------- */
/*  Turning on and off                                 */
/* -------------------------------------------------- */

function mount() {
  if (document.body.classList.contains(BODY_CLASS)) return;
  log("turning mobile mode on in this browser.");
  startCapture();
  document.body.classList.add(BODY_CLASS);
  silenceResolutionNotices();

  ui_.rail = buildRail();
  ui_.bar = buildBar();
  ui_.writeClose = el("button", {
    type: "button",
    id: "msp-write-close",
    "aria-label": t("MSP.Common.Close", "Close"),
    onclick: () => showChatForm(false)
  }, el("i", { class: "fa-solid fa-xmark" }));

  document.body.append(ui_.rail, ui_.bar, ui_.writeClose);
  setTab("chat");
  reportForeignChrome();
  watchChatLog();
  scrollChatToBottom();

  const onMessage = (msg) => safe("new message", () => {
    flagChatPip();
    // A message of our own means the player is done typing: put the field away.
    if (msg?.author?.id === game.user?.id) showChatForm(false);
    // Instrumentation, not decoration: if a message is created but its card
    // never reaches the log, THIS is the line that proves it next time.
    safe("log the arrival", () => {
      const id = msg?.id ?? "?";
      const before = document.querySelector("#chat .chat-log")?.childElementCount ?? -1;
      setTimeout(() => {
        const after = document.querySelector("#chat .chat-log")?.childElementCount ?? -1;
        const landed = !!document.querySelector(`#chat .chat-log [data-message-id="${id}"]`);
        pushLog("INFO ", [`message ${id}: log ${before} -> ${after}, card in DOM: ${landed}`]);
      }, 800);
    });
  });
  Hooks.on("createChatMessage", onMessage);
  ui_.hooks.push(["createChatMessage", onMessage]);

  const refresh = () => safe("rebuild the rail", () => {
    const fresh = buildRail();
    ui_.rail?.replaceWith(fresh);
    ui_.rail = fresh;
  });
  for (const h of ["updateActor", "createItem", "deleteItem", "updateItem"]) {
    Hooks.on(h, refresh);
    ui_.hooks.push([h, refresh]);
  }

  // Keep the sidebar pinned. Anything may re-render or collapse it — a core
  // action, another module, a resize — and a collapse is the failure that
  // silently moves the message field out of our layout.
  const pin = () => safe("re-pin sidebar", () => {
    if ((document.body.dataset.mspTab ?? "chat") === "chat") pinSidebar();
  });
  for (const h of ["renderSidebar", "collapseSidebar"]) {
    Hooks.on(h, pin);
    ui_.hooks.push([h, pin]);
  }
}

function unmount() {
  safe("unmount", () => {
    document.body.classList.remove(BODY_CLASS, "msp-writing");
    delete document.body.dataset.mspTab;
    ui_.rail?.remove(); ui_.rail = null;
    ui_.bar?.remove(); ui_.bar = null;
    ui_.writeClose?.remove(); ui_.writeClose = null;
    closeOverlay();
    for (const [hook, fn] of ui_.hooks) Hooks.off(hook, fn);
    ui_.hooks.length = 0;
    unwatchChatLog();
    restoreResolutionNotices();
    stopCapture();
    safe("restart the ticker", () => canvas?.app?.ticker?.start());
  });
}

async function disableAndReload() {
  await safe("turn off", async () => {
    await game.settings.set(MOD, "enabled", false);
    unmount();
  });
}

/**
 * Offer mobile mode. Asks on EVERY load of a touch device while the mode is
 * off — that is deliberate: on a phone the settings window is nearly unusable,
 * so a player who turns the mode off would otherwise have no way back in.
 * "Don't ask on this device" is the escape hatch for anyone who finds it noisy.
 */
async function maybeAsk() {
  if (setting("dismissed") === true) return;
  if (!isTouch()) return;
  await safe("first-run prompt", async () => {
    const D = foundry.applications.api.DialogV2;
    const choice = await D.wait({
      window: { title: "Mobile Simple Play" },
      content: `<p>${t("MSP.Prompt.Detected", "This device looks like a phone or a tablet.")}</p>
                <p>${t("MSP.Prompt.Question", "Turn on <strong>mobile mode</strong> in this browser? It applies here only — it changes nothing for the other players, and you can turn it off at any time from the <em>More</em> button.")}</p>`,
      buttons: [
        { action: "yes", label: t("MSP.Prompt.Yes", "Turn it on"), default: true },
        { action: "later", label: t("MSP.Prompt.Later", "Not now") },
        { action: "never", label: t("MSP.Prompt.Never", "Don't ask on this device") }
      ],
      rejectClose: false,
      modal: true
    });
    if (choice === "yes") {
      await game.settings.set(MOD, "enabled", true);
      mount();
    } else if (choice === "never") {
      await game.settings.set(MOD, "dismissed", true);
    }
  });
}

/* -------------------------------------------------- */
/*  Entry point                                        */
/* -------------------------------------------------- */

Hooks.once("init", () => {
  safe("register settings", () => {
    game.settings.register(MOD, "enabled", {
      name: "MSP.Settings.Enabled.Name",
      hint: "MSP.Settings.Enabled.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
      onChange: (v) => safe("onChange enabled", () => (v ? mount() : unmount()))
    });

    game.settings.register(MOD, "skills", {
      name: "MSP.Settings.Skills.Name",
      hint: "MSP.Settings.Skills.Hint",
      scope: "user",
      config: true,
      type: String,
      default: "",
      onChange: () => safe("onChange skills", () => {
        if (document.body.classList.contains(BODY_CLASS)) { unmount(); mount(); }
      })
    });

    // "Never offer mobile mode again in this browser."
    game.settings.register(MOD, "capture", {
      name: "MSP.Settings.Capture.Name",
      hint: "MSP.Settings.Capture.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: false
    });

    game.settings.register(MOD, "dismissed", {
      scope: "client",
      config: false,
      type: Boolean,
      default: false
    });
  });
  log(`v${VERSION} loaded, inert. Nothing happens until someone turns it on.`);
});

Hooks.once("ready", () => {
  safe("ready", async () => {
    if (setting("enabled") === true) mount();
    else await maybeAsk();
  });
});

// Exposed for console debugging only, should we need it.
globalThis.MobileSimplePlay = { mount, unmount, setTab, openTargetPicker, openHotbar, saveLog, maybeAsk, logBuffer };
