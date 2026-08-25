/**
 * Mobile Simple Play — v0.1.21
 *
 * SAFETY PRINCIPLE OF THIS VERSION — read this before touching anything:
 *
 *   THE MODULE IS BORN INERT. While the `enabled` setting is false — and it is
 *   false by default — it swaps no core class, patches no global and registers
 *   no listener. On load it declares its settings and adds exactly ONE element:
 *   the view-toggle button on the left control column (D-TOGGLE-01) — a switch
 *   that only existed after you flipped it would be no switch at all. That is
 *   the single, deliberate exception, requested by Mario on 2026-08-23.
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
const VERSION = "0.1.22";
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
  hooks: [], capture: null, notify: null, logWatch: null, postOne: null,
  stick: null, dsn: null, gestures: null, rootFont: null
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

/**
 * The async sibling of safe(). safe() only guards SYNCHRONOUS throws: hand it
 * an async function and it hands back a rejected promise, which then escapes
 * the try/catch entirely. The test harness caught exactly that in v0.1.7.
 */
async function safeAsync(label, fn) {
  try {
    return await fn();
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

/* -------------------------------------------------- */
/*  Chat diagnosis — the one thing that must work      */
/* -------------------------------------------------- */

/**
 * v0.1.8 was a DIAGNOSTIC release for one question: why does a message created
 * on the GM's client never appear in the player's log? It wrote the decision
 * points to the browser console, and the field log of 2026-08-22 answered it.
 *
 * THE ANSWER, so nobody has to re-derive it: the message was never lost. Every
 * candidate mechanism was refuted by the log itself —
 *
 *     postOne(...) IN  · visible=true · rendered=true · element===#chat:true
 *     postOne(...) OUT · cards 89 -> 90 · inFoundryLog=true · inVisibleLog=true
 *
 * The card reached the player's own <ol class="chat-log"> every single time,
 * including one authored by the Gamemaster. What never happened was the SCROLL:
 * with 89 messages the log stands ~29 000 px tall inside a 728 px window, so a
 * card appended at the bottom sits some 28 000 px below the fold. Invisible is
 * indistinguishable from absent. See the comment on scrollChatToBottom() for
 * why both Foundry's scroll and ours failed, and what v0.1.9 does instead.
 *
 * The instrumentation stays — it is cheap, off the hot path, and the next chat
 * bug should be answered from a log rather than from a guess. It now also
 * reports the scroll geometry, the datum whose absence cost five releases.
 */
const DIAG = "MSP-DIAG";

function diag(...parts) {
  const line = parts.join(" · ");
  pushLog("DIAG ", [line]);
  try { console.info(`${DIAG} |`, line); } catch { /* never break on logging */ }
}

/** A photograph of the chat's plumbing at this instant. */
function describeChat(messageId) {
  return safe("describe chat", () => {
    const chat = ui.chat ?? null;
    const own = chat?.element ?? null;                       // what Foundry writes into
    const visible = document.querySelector("#chat");          // what the player looks at
    const ownLog = own?.querySelector?.(".chat-log") ?? null;
    const visLog = document.querySelector("#chat .chat-log");
    const has = (root) => messageId && root
      ? !!root.querySelector(`[data-message-id="${messageId}"]`) : "-";
    return [
      `class=${chat?.constructor?.name ?? "?"}`,
      `rendered=${chat?.rendered}`,                           // <- the silent killer
      `element===#chat:${own === visible}`,                   // <- the other silent killer
      `connected=${own?.isConnected}`,
      `cards(foundry)=${ownLog?.childElementCount ?? "-"}`,
      `cards(visible)=${visLog?.childElementCount ?? "-"}`,
      `isAtBottom=${chat?.isAtBottom}`,
      `scroll=${describeScroll()}`,
      `sidebarExpanded=${ui.sidebar?.expanded}`,
      `activeTab=${ui.sidebar?.tabGroups?.primary}`,
      `inFoundryLog=${has(ownLog)}`,
      `inVisibleLog=${has(visLog)}`
    ].join(" · ");
  }) ?? "describe failed";
}

/**
 * Wrap ChatLog#postOne so we can see whether it is called at all, and what it
 * left behind. This is the only way to tell three very different failures
 * apart, which look identical from the outside:
 *
 *   postOne never called          -> the message never reached this client
 *   called, rendered=false        -> Foundry dropped it on purpose
 *   called, card in foundry log
 *          but not in visible log -> it went into a detached element
 */
function instrumentChat() {
  safe("instrument chat", () => {
    const chat = ui.chat;
    if (!chat || ui_.postOne || typeof chat.postOne !== "function") return;
    const prior = Object.getOwnPropertyDescriptor(chat, "postOne") ?? null;
    const original = chat.postOne.bind(chat);
    ui_.postOne = { prior, chat };
    chat.postOne = async function(message, options = {}) {
      const id = message?.id ?? "?";
      diag(`postOne(${id}) IN`, `visible=${message?.visible}`, describeChat(id));
      const out = await original(message, options);
      setTimeout(() => diag(`postOne(${id}) OUT`, describeChat(id)), 500);
      return out;
    };
    diag("instrumented postOne", describeChat());
  });
}

function uninstrumentChat() {
  safe("uninstrument chat", () => {
    if (!ui_.postOne) return;
    const { prior, chat } = ui_.postOne;
    if (prior) Object.defineProperty(chat, "postOne", prior);
    else delete chat.postOne;
    ui_.postOne = null;
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
 * D-NOTIFY-01, 2026-08-25. Two things at once, and the first is a bug of ours.
 *
 * ---- THE BUG, found in Mario's own diagnostic log --------------------------
 *
 *     Uncaught Error: You must pass a Notification or numeric ID to
 *                     Notifications#remove
 *         at Notifications.remove (foundry.mjs:145427)
 *         at #validateResolution (foundry.mjs:203521)
 *
 * repeated on every resize — and a phone resizes constantly, because the URL
 * bar hides and shows as you scroll.
 *
 * We caused it. The previous version of this function shadowed
 * `ui.notifications.notify` and returned `-1` for the resolution notice.
 * Foundry KEEPS that return value: `#validateResolution` stores it and later
 * calls `remove()` with it to take the notice down. Handed a `-1` that never
 * corresponded to a notification, `remove()` throws.
 *
 * The lesson is worth more than the fix. Intercepting a host function is not
 * free just because the interception is small: whatever the host does with the
 * RETURN VALUE is now our responsibility too, and we cannot know what that is.
 * The module's own first principle — Foundry is the authority — argues against
 * standing in the middle of its bookkeeping at all.
 *
 * ---- MARIO'S REQUEST, same day --------------------------------------------
 *
 * "Todos esses avisos em vermelho do FVTT deveriam ser desabilitados no mobile."
 * He is right. On a phone, a red toast covers the chat — which IS the game —
 * and the player can act on almost none of them: they are addressed to whoever
 * is running the world, on a machine with a keyboard.
 *
 * ---- THE DESIGN THAT SOLVES BOTH ------------------------------------------
 *
 * Stop intercepting. Let Foundry and every module create their notifications
 * exactly as they always did, so every return value stays real and nobody's
 * bookkeeping breaks. Then simply do not SHOW the ones the player cannot act
 * on — a matter of CSS, in `body.msp-on`, which changes nothing for anyone
 * else and undoes itself the moment mobile mode is turned off.
 *
 * Nothing is lost, and that distinction matters: an observer copies every
 * hidden notice into the diagnostic log, so `More -> Save diagnostic log`
 * still carries it. The notice is moved, not silenced.
 *
 * `info` and `success` stay on screen. They are the module's own way of
 * answering the player — "log saved", "target set" — and a phone with no
 * feedback at all is worse than a phone with a red box.
 */
function silenceResolutionNotices() {
  safe("watch notifications", () => {
    const list = document.querySelector("#notifications");
    if (!list || ui_.noteWatch) return;

    const record = (node) => safe("log a hidden notice", () => {
      if (!(node instanceof HTMLElement)) return;
      if (!node.classList.contains("error") && !node.classList.contains("warning")) return;
      const kind = node.classList.contains("error") ? "error" : "warning";
      const text = (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
      diag("notice hidden", `${kind} · ${text}`);
    });

    for (const node of list.children) record(node);
    const watch = new MutationObserver((records) => {
      for (const r of records) for (const node of r.addedNodes) record(node);
    });
    watch.observe(list, { childList: true });
    ui_.noteWatch = watch;
  });
}

function restoreResolutionNotices() {
  safe("stop watching notifications", () => {
    ui_.noteWatch?.disconnect();
    ui_.noteWatch = null;
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

/* -------------------------------------------------- */
/*  Rolling the way the sheet does                     */
/* -------------------------------------------------- */

/**
 * FIELD FINDING OF 2026-08-23 (the card-fidelity round).
 *
 * The rich chat card this table lives on — dice tray, reroll and Benny
 * buttons, the whole targeted-damage chain — is NOT the raw SWADE card. It is
 * manufactured by swade-tools, which intercepts the roll made from the sheet.
 * The hotbar macro reaches the same factory with one line:
 *
 *     game.swade.rollItemMacro("Espada curta de Bronze");
 *
 * Until v0.1.10 the rail called `item.show()` instead: that posts the ITEM
 * card, demands a second tap, and that second tap fires the system's bare
 * roll — under the interceptor. Working, but a poorer card and one tap too
 * many. So the rail now enters through the same door as the sheet and the
 * hotbar. The old behaviour stays as the fallback for a world without the
 * SWADE macro API.
 */
function rollItemLikeTheSheet(item) {
  const viaMacro = game.swade?.rollItemMacro;
  if (typeof viaMacro === "function") return void viaMacro(item.name);
  item.show?.();
}

function rollSkillLikeTheSheet(actor, skill) {
  const viaMacro = game.swade?.rollSkillMacro;
  if (typeof viaMacro === "function") return void viaMacro(skill.name);
  actor.rollSkill?.(skill.id, {});
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
      onClick: () => rollItemLikeTheSheet(item)
    }));
  }

  if (top.childElementCount) top.append(el("hr", { class: "msp-div" }));

  // SKILLS
  for (const skill of chosenSkills(actor)) {
    top.append(railButton({
      img: skill.img,
      label: skill.name,
      cls: "msp-skill",
      onClick: () => rollSkillLikeTheSheet(actor, skill)
    }));
  }

  rail.append(top);

  /* FOOT OF THE RAIL — D-RAIL-02, 2026-08-25, read off Mario's screen mockup.
     Order, top to bottom: TARGET, BENNY, WOUNDS.

     This REVERSES what was built a few hours earlier. His sentence had been "o
     Benny, ele vai ficar na esquerda, em cima do alvo", which I read as "above
     the target" and implemented that way. His mockup, drawn afterwards and at
     the real viewport, puts the crosshair first and the benny under it. The
     drawing is later and unambiguous, so the drawing wins — and this note stays
     so nobody "fixes" the order back on the strength of the old sentence. */
  const foot = el("div", { class: "msp-rail-foot" });
  foot.append(railButton({
    label: t("MSP.Target.Label", "Target"),
    cls: "msp-target",
    img: `modules/${MOD}/icons/target-001.svg`,
    onClick: openTargetPicker
  }));
  const benny = buildBennyButton(actor);
  if (benny) foot.append(benny);
  foot.append(buildStatusBadges(actor));
  rail.append(foot);

  return rail;
}

/* What is left of the old badge column: the wounds picture, alone. The bennies
   badge went with D-BENNY-02 — the benny button now carries its own count, and
   the rail had been printing that number twice. */
function buildStatusBadges(actor) {
  const box = el("div", { class: "msp-status" });
  safe("status badges", () => {
    if (actor.system?.wounds) box.append(buildWoundsIcon(actor));
  });
  return box;
}

/* -------------------------------------------------- */
/*  D-WOUNDS-01 — wounds as a picture, not a fraction  */
/* -------------------------------------------------- */

/* Mario drew five states in Illustrator and asked for the count beside them:
   three red drops when whole, one drop going grey per wound, a skull when the
   character is out. The number is the drops still RED — how many more hits the
   character can take — not the wounds already suffered. Those two readings are
   inverses of each other, and shipping the wrong one would make the rail lie
   about whether the player is safe. It is spelled out here for that reason.

   Fatigue left with this change, by his call: "eu so preciso do life, nao
   preciso da fadiga nao".

   The art is his file, referenced as <img> and never inlined. Inlining is the
   tempting option — it would let CSS recolour the drops — but the five files all
   declare `.cls-1` through `.cls-8` with DIFFERENT meanings, so two of them in
   one document repaint each other. Verified on the bench: rendering all five
   together required scoping every rule by hand. As <img> each file keeps its
   own stylesheet, and the drawing stays exactly as it left Illustrator. */

const WOUND_ART = ["Wounds-00", "Wounds-01", "Wounds-02", "Wounds-03"];
const WOUND_ART_OUT = "Wounds-Death";

/* Read from the SWADE source, not guessed (src/module/data/actor/base/creature.ts):
   `system.wounds.value` counts wounds taken and `system.wounds.max` is 3 for a
   Wild Card, 1 for an Extra. Being out of the fight is NOT wounds.value = 4: it
   is the `incapacitated` status effect, which SWADE exposes as
   `system.status.isIncapacitated` over core Foundry's `actor.statuses`. A Wild
   Card who fails the Vigor roll is out at three wounds, so counting alone would
   miss him. Ask the status first, fall back to core, then to the count. */
function woundState(actor) {
  const sys = actor?.system ?? {};
  const max = Number(sys.wounds?.max ?? 3) || 3;
  const taken = Math.max(0, Math.min(Number(sys.wounds?.value ?? 0) || 0, max));

  const out = sys.status?.isIncapacitated
    ?? actor?.statuses?.has?.("incapacitated")
    ?? (taken > max);

  /* A three-step ramp for a three-wound sheet. An Extra has max 1, and drawing
     his single wound as "two drops gone" would be a lie of a different kind — so
     the art is picked by PROPORTION whenever the sheet is not the usual three. */
  const left = max - taken;
  const step = max === 3 ? taken : Math.round((taken / max) * 3);

  return { out: !!out, taken, max, left, art: out ? WOUND_ART_OUT : WOUND_ART[Math.min(step, 3)] };
}

/* -------------------------------------------------- */
/*  D-BENNY-01 — spending a benny from the rail        */
/* -------------------------------------------------- */

/* D-BENNY-02, 2026-08-25. Mario drew the bennies the same way he drew the
   wounds — art plus a chip — and stated the rule himself:
   "quando ele tiver com tres, aparece os tres... a numeracao vai indicar
   exatamente a quantidade, mas passou de tres, o icone sempre e o de tres".

   So the two halves say DIFFERENT things on purpose, and that is the whole
   design: the picture is a coarse gauge that saturates at three, the number is
   exact and does not. Four bennies show three chips and the numeral 4. Nobody
   has to draw a fourth token, and nothing lies — the numeral is right there.

   This replaces the icon-only button built earlier today, and the separate
   `.msp-bennies` numeric badge is gone with it: the rail was printing that
   figure twice, which was flagged at the time as a question for his layout.
   The layout answered.

   Read from the SWADE source (SwadeActor.ts, line 565): `actor.bennies` is a
   getter over `system.bennies.value`, and `spendBenny()` already returns false
   when there is nothing to spend. The guard below is therefore not defensive
   decoration — it is so the button LOOKS spent, because on a phone there is no
   hover to reveal that a live-looking button will do nothing.

   We do NOT touch `dsnShowBennyAnimation`. It is the player's own flag, stored
   on the server, and writing someone's preference to work around our own layout
   is the kind of interception this module already regretted once with
   `Notifications#remove`. The 3D die is handled where it belongs — in CSS,
   under `body.msp-on`. See D-BENNY-01 in the stylesheet. */

const BENNY_ART = ["BennieBlank", "Bennie01", "Bennie02", "Bennies-003"];

function bennyState(actor) {
  const count = Math.max(0, Number(actor?.bennies ?? actor?.system?.bennies?.value ?? 0) || 0);
  return { count, art: BENNY_ART[Math.min(count, 3)] };   // saturates at three, by his rule
}

function buildBennyButton(actor) {
  return safe("benny button", () => {
    if (typeof actor?.spendBenny !== "function") return null;   // not a SWADE actor
    const s = bennyState(actor);

    const label = s.count > 0
      ? `${t("MSP.Benny.Spend", "Spend a benny")} (${s.count})`
      : t("MSP.Benny.None", "No bennies left");

    const btn = el("button", {
      type: "button",
      class: `msp-slot msp-badge msp-benny${s.count > 0 ? "" : " msp-benny-empty"}`,
      "aria-label": label,
      title: label,
      onclick: (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (s.count > 0) safeAsync("spend a benny", () => actor.spendBenny());
      }
    },
      el("img", { class: "msp-benny-art", src: `modules/${MOD}/icons/bennies/${s.art}.svg`, alt: "" }),
      el("span", { class: "msp-benny-chip", "data-empty": s.count ? "no" : "yes", "aria-hidden": "true", text: String(s.count) })
    );
    if (s.count < 1) btn.setAttribute("aria-disabled", "true");
    attachLongPress(btn, label);
    return btn;
  }) ?? null;
}

function buildWoundsIcon(actor) {
  const s = woundState(actor);
  const label = s.out
    ? t("MSP.Status.Incapacitated", "Incapacitated")
    : `${t("MSP.Status.Wounds", "Wounds")}: ${s.taken}/${s.max}`;

  /* role="img" with aria-label, because the meaning lives in a picture and a
     single glyph: a screen reader must hear the sentence, not "2". */
  return el("div", { class: "msp-badge msp-wounds", role: "img", "aria-label": label, title: label },
    el("img", { class: "msp-wounds-art", src: `modules/${MOD}/icons/wounds/${s.art}.svg`, alt: "" }),
    el("span", {
      class: "msp-wounds-chip",
      "data-left": s.out ? "out" : String(s.left),
      "aria-hidden": "true",
      text: s.out ? "X" : String(s.left)
    })
  );
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
      class: `${b.primary ? "msp-primary" : ""}${b.danger ? " msp-danger" : ""}`.trim(),
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

/**
 * D-CANVAS-02 (2026-08-23): entering the map tab ALWAYS lands on the player's
 * own token, framed the way Mario's reference capture frames it — the token
 * about one grid square wide on screen, roughly 2.5 squares of world visible
 * across the viewport. Positioning is the whole point of the mobile map
 * (D-CANVAS-01), and positioning starts with "where am I?".
 *
 * The zoom is a FORMULA, not a magic number, so any phone gets the same
 * framing: scale = usable width / (2.5 * grid size), clamped to sanity.
 */
/* -------------------------------------------------- */
/*  Canvas gestures — the finger drives the camera     */
/* -------------------------------------------------- */

/**
 * D-CANVAS-03 (2026-08-23). Until now the map tab framed the player's token
 * and then froze: there was no way to look anywhere else. Foundry's canvas is
 * driven by mouse verbs — right-drag to pan, wheel to zoom — and a phone has
 * neither. Worse, a browser left to itself answers a two-finger pinch by
 * zooming the PAGE, which on our fixed layout does nothing but blur it.
 *
 * So mobile mode drives the camera itself, with the two gestures everyone
 * already knows:
 *
 *   one finger  drag   -> pan
 *   two fingers pinch  -> zoom, ANCHORED between the fingers
 *
 * "Anchored" is what separates a good pinch from a nauseating one: the point
 * of the map you pinched must stay under your fingers while the scale changes.
 * The arithmetic is one screen->world conversion, and it is the same formula
 * for both gestures — a one-finger drag is simply the case where scale does
 * not change.
 *
 * SAFETY. The listeners sit on #board in the CAPTURE phase and stop
 * propagation ONLY once a drag has passed the slop threshold. A tap therefore
 * still reaches Foundry untouched, which keeps selecting and targeting a token
 * working, and leaves the door open for the deeper work (dragging the token
 * itself, with the movement ruler) without a rewrite.
 */
/**
 * D-SCALE-01 (2026-08-23). On Mario's phone the whole interface came out
 * "tudo pequenininho" — the rail a sliver, the cards' type unreadable. The
 * snapshot explains it: the browser reports a viewport far wider than a phone
 * naturally has (a phone gives ~412 CSS px; the measurements pointed at
 * 800-1200). Chrome's "Desktop site" is the usual cause, and the module cannot
 * turn it off from inside.
 *
 * What it CAN do is stop trusting the CSS pixel. Every measurement in the
 * stylesheet is a multiple of --msp-scale, and this function sets that scale
 * to whatever keeps the interface the same PHYSICAL size it was designed to
 * be. On a phone in its natural viewport the scale is exactly 1 and nothing
 * changes; if Mario turns "Desktop site" off, it silently returns to 1.
 *
 * The guard on isTouch() matters: a real tablet or a desktop browser has a
 * wide viewport AND a big screen, and must be left alone.
 */
const REFERENCE_WIDTH = 412;   // a typical phone, in its own viewport
const NATURAL_MAX = 600;       // above this, a touch device is being stretched

function deviceScale() {
  return safe("device scale", () => {
    const iw = window.innerWidth || REFERENCE_WIDTH;
    const auto = (!isTouch() || iw <= NATURAL_MAX)
      ? 1
      : Math.min(3, Math.round((iw / REFERENCE_WIDTH) * 20) / 20);
    // The player's own thumb is the final authority: a taste setting, stored
    // per browser, multiplies whatever the automatic reading was. Mario asked
    // for bigger; someone else's eyes will ask for smaller.
    const taste = Number(setting("uiSize"));
    return Math.min(4, Math.max(0.6, auto * (Number.isFinite(taste) && taste > 0 ? taste : 1)));
  }) ?? 1;
}

function applyDeviceScale() {
  safe("apply device scale", () => {
    const scale = deviceScale();
    // On BOTH: the body for our own rules, the root because Foundry and SWADE
    // size a great deal of their own interface in `rem` — which resolves
    // against the root font size and nothing else. Moving that one number
    // carries the system's whole layout with it, which is what "adjust to the
    // screen" actually means.
    document.documentElement.style.setProperty("--msp-scale", String(scale));
    document.body.style.setProperty("--msp-scale", String(scale));
    if (!ui_.rootFont) ui_.rootFont = { prior: document.documentElement.style.fontSize || "" };
    document.documentElement.style.fontSize = `${(16 * scale).toFixed(1)}px`;
    diag("viewport",
      `inner=${window.innerWidth}x${window.innerHeight}`,
      `dpr=${window.devicePixelRatio ?? "?"}`,
      `screen=${window.screen?.width ?? "?"}x${window.screen?.height ?? "?"}`,
      `touch=${isTouch()}`,
      `uiSize=${setting("uiSize") ?? "-"}`,
      `--msp-scale=${scale}`);
  });
}

function restoreDeviceScale() {
  safe("restore device scale", () => {
    document.documentElement.style.removeProperty("--msp-scale");
    document.body.style.removeProperty("--msp-scale");
    document.documentElement.style.fontSize = ui_.rootFont?.prior ?? "";
    ui_.rootFont = null;
  });
}

const GESTURE_SLOP = 6;      // px of travel before a touch counts as a drag
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 3;

/** The camera right now, in world coordinates. */
function camera() {
  return {
    x: canvas?.stage?.pivot?.x ?? 0,
    y: canvas?.stage?.pivot?.y ?? 0,
    scale: canvas?.stage?.scale?.x ?? 1
  };
}

/** Centre of the board element, in screen pixels. */
function viewportCentre(board) {
  const r = board.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

/** Which point of the MAP sits under this screen pixel. */
function screenToWorld(px, py, cam, vp) {
  return {
    x: cam.x + (px - vp.cx) / cam.scale,
    y: cam.y + (py - vp.cy) / cam.scale
  };
}

function enableCanvasGestures() {
  if (ui_.gestures) return;
  safe("canvas gestures", () => {
    const board = document.querySelector("#board");
    if (!board) return;

    const pts = new Map();                 // live pointers, by id
    let g = null;                          // the gesture in flight

    const positions = () => [...pts.values()];
    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    /** Start (or restart) a gesture from whatever fingers are down now. */
    const begin = () => {
      const p = positions();
      if (!p.length) { g = null; return; }
      const cam = camera();
      const vp = viewportCentre(board);
      const mid = p.length >= 2 ? midpoint(p[0], p[1]) : p[0];
      g = {
        cam, vp, mid,
        fingers: p.length,
        dist: p.length >= 2 ? distance(p[0], p[1]) : 0,
        anchor: screenToWorld(mid.x, mid.y, cam, vp),
        moved: false
      };
    };

    /**
     * FIELD REPORT, 2026-08-23: "quando a gente clica no token e tenta mover
     * pra um lado e pro outro, ele move a tela inteira."
     *
     * Exactly so — v0.1.15 claimed EVERY one-finger drag for the camera, the
     * token underneath included. The cure is to ask, at the moment the finger
     * lands, whether it landed on a token this player may move. If it did, the
     * gesture is not ours: we stay out and Foundry drags the token, movement
     * ruler and all. Two fingers still pinch, because a pinch is never a drag.
     */
    const myTokenAt = (px, py) => safe("token hit test", () => {
      const cam = camera();
      const w = screenToWorld(px, py, cam, viewportCentre(board));
      return (canvas?.tokens?.placeables ?? []).find(tk => {
        if (!(tk.actor?.isOwner ?? tk.isOwner ?? false)) return false;
        const x = tk.x ?? tk.document?.x, y = tk.y ?? tk.document?.y;
        const bw = tk.w ?? tk.width ?? 0, bh = tk.h ?? tk.height ?? 0;
        if (x === undefined || !bw || !bh) return false;
        return w.x >= x && w.x <= x + bw && w.y >= y && w.y <= y + bh;
      }) ?? null;
    }) ?? null;

    const onDown = ev => safe("gesture down", () => {
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pts.size === 1) {
        const tk = myTokenAt(ev.clientX, ev.clientY);
        if (tk) {                          // hands off: this drag moves a token
          g = null;
          ui_.gestures.yielded = true;
          diag("gesture yielded to token", tk.name ?? "?");
          return;
        }
        ui_.gestures.yielded = false;
      }
      // A second finger always means pinch, even over a token.
      if (pts.size >= 2) ui_.gestures.yielded = false;
      begin();
    });

    const onMove = ev => safe("gesture move", () => {
      if (!pts.has(ev.pointerId) || !g || ui_.gestures?.yielded) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const p = positions();
      if (p.length !== g.fingers) { begin(); return; }

      const mid = p.length >= 2 ? midpoint(p[0], p[1]) : p[0];

      if (!g.moved) {
        if (Math.hypot(mid.x - g.mid.x, mid.y - g.mid.y) < GESTURE_SLOP && p.length < 2) return;
        g.moved = true;
      }
      // From here this is OUR gesture: Foundry must not also act on it.
      ev.stopPropagation();
      if (ev.cancelable) ev.preventDefault();

      let scale = g.cam.scale;
      if (p.length >= 2 && g.dist > 0) {
        scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, g.cam.scale * (distance(p[0], p[1]) / g.dist)));
      }
      // Keep the anchored point of the map under the fingers.
      const x = g.anchor.x - (mid.x - g.vp.cx) / scale;
      const y = g.anchor.y - (mid.y - g.vp.cy) / scale;
      canvas?.pan?.({ x, y, scale });
    });

    const onUp = ev => safe("gesture up", () => {
      pts.delete(ev.pointerId);
      if (!pts.size) {
        if (g?.moved) diag("gesture end", `scale=${camera().scale.toFixed(2)}`);
        g = null;
      } else begin();
    });

    ui_.gestures = { board, onDown, onMove, onUp, yielded: false };
    board.addEventListener("pointerdown", onDown, { capture: true });
    board.addEventListener("pointermove", onMove, { capture: true, passive: false });
    board.addEventListener("pointerup", onUp, { capture: true });
    board.addEventListener("pointercancel", onUp, { capture: true });
    pushLog("INFO ", ["canvas gestures on: one finger pans, two fingers pinch"]);
  });
}

function disableCanvasGestures() {
  safe("disable gestures", () => {
    const gs = ui_.gestures;
    if (!gs) return;
    gs.board.removeEventListener("pointerdown", gs.onDown, { capture: true });
    gs.board.removeEventListener("pointermove", gs.onMove, { capture: true });
    gs.board.removeEventListener("pointerup", gs.onUp, { capture: true });
    gs.board.removeEventListener("pointercancel", gs.onUp, { capture: true });
    ui_.gestures = null;
  });
}

const MAP_SQUARES_ACROSS = 2.5;

function focusMyToken() {
  safe("focus my token", () => {
    if (!canvas?.ready) return;
    const me = myActor();
    const token = canvas.tokens?.placeables?.find(tk => tk.actor?.id === me?.id && !tk.document?.hidden)
      ?? canvas.tokens?.placeables?.find(tk => tk.actor?.id === me?.id);
    if (!token) return;
    const grid = canvas.grid?.size || 150;
    const rail = parseInt(safe("read rail width", () =>
      window.getComputedStyle?.(document.body).getPropertyValue("--msp-rail")) ?? "") || 48;
    // Divide by the device scale: on a stretched viewport the window REPORTS
    // more pixels than the glass has, and framing by the inflated number
    // zoomed the map far past the reference capture.
    const usable = Math.max(200, ((window.innerWidth || 360) - rail) / (deviceScale() || 1));
    const scale = Math.min(1.5, Math.max(0.4, usable / (MAP_SQUARES_ACROSS * grid)));
    const { x, y } = token.center ?? { x: token.x, y: token.y };
    (canvas.animatePan ?? canvas.pan)?.call(canvas, { x, y, scale });
    diag(`map focus on ${token.name ?? me?.name ?? "?"}`, `x=${Math.round(x)} y=${Math.round(y)} scale=${scale.toFixed(2)}`);
  });
}

/**
 * The combat carousel (combat-tracker-dock) vanished in mobile mode, and the
 * field could not yet say WHY — position saved for a desktop viewport, a
 * transform, a z-order, all plausible. Two answers in one:
 *  - the CSS re-anchors #combat-dock to the top of the map area with
 *    !important (which outranks the inline left/top a drag leaves behind),
 *    fixing every positional cause at once, and shows it ONLY on the map tab
 *    — Mario's rule: chat is chat, combat lives on the map;
 *  - this diagnostic photographs the dock so the next log names the cause.
 */
function describeDock() {
  return safe("describe dock", () => {
    const dock = document.querySelector("#combat-dock");
    if (!dock) return "no #combat-dock in the DOM";
    const r = dock.getBoundingClientRect();
    const c = getComputedStyle(dock);
    return `dock rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
      + ` · display=${c.display} · vis=${c.visibility} · z=${c.zIndex} · parent=#${dock.parentElement?.id || dock.parentElement?.tagName}`
      + ` · inline=${dock.getAttribute("style")?.slice(0, 120) ?? "-"}`;
  }) ?? "describe dock failed";
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
    if (tab === "map") {
      applyDeviceScale();        // a rotation may have changed the viewport
      focusMyToken();
      diag("map tab", describeDock());
    }
  });
}

/**
 * The MasterQuest player panel, or null when the module is not there.
 *
 * Returned as a function rather than a boolean so the lookup happens once, at
 * build time, and the click calls exactly what was found — no second guess at
 * the moment the player taps.
 */
function questLogOpener() {
  return safe("find the quest log", () => {
    const api = game.modules?.get("master-quest")?.api ?? globalThis.MasterQuest;
    const open = api?.masterQuest?.openQuestLog;
    return typeof open === "function" ? () => api.masterQuest.openQuestLog() : null;
  }) ?? null;
}

/**
 * D-JOURNAL-01 — find a way to open the journal directory, or admit there is none.
 *
 * Two doors are tried, in order of how directly they name the thing:
 * `ui.journal` is the directory itself; `ui.sidebar.tabs.journal` is the same
 * object reached through the sidebar, which is where Foundry 14 moved the tab
 * registry. Whichever answers with a callable `renderPopout` wins.
 *
 * A popout, not a sidebar tab switch: MSP pins the sidebar to the chat, so
 * switching tabs there would fight our own layout. A window, on the other hand,
 * is already handled — D-WINDOW-01 pins every Foundry window to the phone
 * screen, so the journal arrives full-screen and framed.
 *
 * Returning null is a real outcome, not a failure: no opener, no menu entry.
 */
function journalOpener() {
  return safe("find the journal", () => {
    const doors = [globalThis.ui?.journal, globalThis.ui?.sidebar?.tabs?.journal];
    for (const d of doors) {
      if (d && typeof d.renderPopout === "function") return () => d.renderPopout();
    }
    return null;
  }) ?? null;
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

  // D-TOGGLE-01: back to the desktop, one tap, leftmost slot.
  bar.append(el("button", {
    type: "button",
    id: "msp-to-desktop",
    "aria-label": t("MSP.Toggle.ToDesktop", "Back to desktop view"),
    onclick: () => safe("back to desktop", () => disableAndReload())
  }, el("img", { src: `modules/${MOD}/icons/icon-desktop-view-mld.svg`, alt: "" })));

  bar.append(tabButton("chat", "fa-solid fa-comments", t("MSP.Tab.Chat", "Chat")));
  if (safe("is the canvas on?", () => !game.settings.get("core", "noCanvas")) ?? false) {
    bar.append(tabButton("map", "fa-solid fa-map", t("MSP.Tab.Map", "Map")));
  }

  // The character button — an action, never "lit".
  // D-QUEST-01, 2026-08-25. Mario runs MasterQuest, his own quest-management
  // module, and asked for a door to it from the phone.
  //
  // The door is one the module already opens for itself. Read in its source
  // (10_Module-Source/master-quest/scripts/init.js), MasterQuest registers its
  // scene-control group for the PLAYER as well as the GM, with a comment saying
  // why: "das quatro ferramentas, so o Quest Log e comum, e as outras tres
  // seguem GM-only". And its own Journal-directory button already splits the
  // two cases exactly as we need:
  //
  //     onClick: () => (isGM ? api.masterQuest.open() : api.masterQuest.openQuestLog())
  //
  // So we call `openQuestLog()` and land straight on the player's panel, with no
  // menu in between — and we invent nothing, which is the rule.
  //
  // The icon is `fa-solid fa-scroll`: MasterQuest's own group icon, chosen by
  // Mario over the Quest Log tool's checklist because on a phone a scroll reads
  // as "the missions" and is what he already recognises in the left column.
  //
  // Detection is defensive, in the same shape as the rail's swade-tools door: in
  // a world without MasterQuest the button is simply never built. Nothing to
  // configure, nothing to fail.
  const quests = questLogOpener();
  if (quests) {
    bar.append(el("button", {
      type: "button",
      id: "msp-quests",
      "aria-label": t("MSP.Quests.Label", "Quests"),
      onclick: () => safe("open the quest log", quests)
    }, el("i", { class: "fa-solid fa-scroll" })));
  }

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
  /* D-JOURNAL-01, 2026-08-25. Mario: "a gente precisa achar uma forma de colocar
     um botão para Journal... pode ser resolvido no Mais". Here, and not on the
     bar: the bar is full at five, and the journal is something a player opens
     between scenes, not mid-turn.

     Looked up rather than assumed, the same shape as the quest opener. I could
     not verify the sidebar API against a local Foundry core in this session, so
     the module ASKS instead of asserting: two known doors, first one that is a
     function wins, and no entry at all when neither answers. Being wrong about
     an API you did not open is how this project lost a round before. */
  const journal = journalOpener();
  if (journal) {
    box.append(el("button", {
      type: "button", text: t("MSP.More.Journal", "Journals"),
      onclick: () => { closeOverlay(); journal(); }
    }));
  }

  /* D-LOGOUT-01, 2026-08-25. Mario: "a opção de Logout do Foundry via MSP, essa
     é importante. Certifique-se que ele venha acompanhada de uma janela de
     confirmação." It takes the slot the diagnostic log used to hold — with the
     Chrome emulator running on his desktop, saving a log from the phone stopped
     earning its place.

     Marked as destructive, and it is: on a phone there is no menu bar to get
     back in with, so a stray thumb ends the session and the player has to find
     the URL again mid-fight. The confirmation is not politeness. */
  box.append(el("button", {
    type: "button", class: "msp-danger", text: t("MSP.More.LogOut", "Log Out"),
    onclick: () => confirmLogOut()
  }));
  // Mario, 2026-08-25: "à medida que a gente tem um ícone, essa opção Turn off
  // mobile é desnecessária". Right: the leftmost button on the bar calls exactly
  // this — disableAndReload() — and is always on screen, while this one costs a
  // tap to reach. Two doors to the same room, one of them hidden. Removed.
  //
  // The way out is not thereby reduced to one: the bar button is always there,
  // and the world setting (Mobile mode, unchecked) remains the escape hatch for
  // a client that somehow cannot render the bar. The README says so.

  openOverlay(t("MSP.More.Label", "More"), box, [
    { label: t("MSP.Common.Close", "Close"), onClick: closeOverlay, primary: true }
  ]);
}

/**
 * D-LOGOUT-01 — leaving the world, on purpose and not by accident.
 *
 * Two things worth stating, because both were deliberate:
 *
 * 1. The confirmation reuses MSP's own overlay rather than Foundry's dialog.
 *    Not for looks: our overlay is already sized to the phone and already
 *    survives the layout, while a Foundry dialog arrives as a window and would
 *    be caught by D-WINDOW-01, filling the screen for a two-line question.
 *
 * 2. CANCEL is the primary button, and the affirmative is the plain one — the
 *    reverse of the usual. The cost of the two mistakes is not symmetrical:
 *    cancelling by accident costs a tap, confirming by accident ends the
 *    session on a device with no menu bar to climb back through.
 *
 * `game.logOut()` is Foundry's own exit. We do not clear settings, flags or
 * storage on the way out: the module's whole principle is that Foundry is the
 * authority, and a log-out that also quietly resets the player's state would be
 * exactly the kind of extra that nobody asked for.
 */
function confirmLogOut() {
  const msg = el("p", { class: "msp-confirm", text: t("MSP.LogOut.Ask",
    "Leave the game and return to the login screen?") });

  openOverlay(t("MSP.More.LogOut", "Log Out"), msg, [
    { label: t("MSP.Common.Cancel", "Cancel"), onClick: closeOverlay, primary: true },
    { label: t("MSP.LogOut.Confirm", "Log out"), danger: true, onClick: () => {
      closeOverlay();
      safe("log out", () => game.logOut());
    } }
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
    // Opening the field is a deliberate act: go to the bottom even if the
    // player had scrolled up to read back.
    scrollChatToBottom("message field opened", { force: true });
  });
}

/* -------------------------------------------------- */
/*  Keeping the chat at the bottom                     */
/* -------------------------------------------------- */

/**
 * THE BUG THIS SOLVES — v0.1.9.
 *
 * Up to v0.1.8 the chat "did not update" for the phone player. The v0.1.8
 * diagnostic release settled what was NOT happening: the message reached the
 * client, `postOne` ran, `rendered` was true, and the card landed in the very
 * `<ol class="chat-log">` the player is looking at. Card count went 89 -> 90 ->
 * 91 -> 92, every time. Nothing was lost.
 *
 * So the card was always there. The VIEW never moved to it. With 89 messages
 * the log is roughly 29 000 px tall inside a 728 px window: a card appended at
 * the bottom is nearly 28 000 px below the fold. Invisible is indistinguishable
 * from absent.
 *
 * Two things were supposed to scroll, and both fail for the same underlying
 * reason — they scroll ONCE, at a moment when the card's final height is not
 * yet known.
 *
 *  1. Foundry's own `ChatLog#scrollBottom({waitImages: true})`. It calls
 *     `Application.waitForImages(scroll)` over the WHOLE log, then sets
 *     scrollTop. That helper has no timeout and assigns `img.onload`/`onerror`
 *     directly — so one image that never settles, or one module that reassigns
 *     a handler on an image (chat-portrait puts an <img> on every message; this
 *     world has 68 of them in the log), and the await never resolves. scrollTop
 *     is then never set at all.
 *
 *  2. Our own v0.1.2-0.1.8 `scrollChatToBottom()`: a single synchronous
 *     `scrollTop = scrollHeight` fired from the MutationObserver, i.e. at the
 *     instant the card is inserted — before its images have loaded and before
 *     layout has settled. A SWADE roll card with dice and a portrait grows by
 *     hundreds of pixels a moment later, and the view is left stranded above
 *     the message it just scrolled to.
 *
 * The fix is to stop treating "scroll to the bottom" as an event and treat it
 * as a STATE. While the player is at the bottom, the module keeps them there:
 * a ResizeObserver on the log re-pins on every height change, whatever caused
 * it — an image, a font, Dice So Nice, another module rewriting a card. If the
 * player deliberately scrolls up to read back, sticking stops until they return
 * to the bottom, because a chat that yanks you downwards while you read is
 * worse than one that does not move.
 */

/** How far from the bottom still counts as "at the bottom", in px. */
const STICK_SLACK = 120;

/** Retry ladder, in ms. Covers late images, fonts and slow module rewrites. */
const STICK_RETRIES = [0, 50, 150, 350, 700, 1200, 2000];

function scrollEl() {
  return document.querySelector("#chat .chat-scroll");
}

function describeScroll() {
  const s = scrollEl();
  if (!s) return "no .chat-scroll";
  const gap = s.scrollHeight - s.scrollTop - s.clientHeight;
  return `top=${Math.round(s.scrollTop)}/h=${s.scrollHeight}/win=${s.clientHeight}/gap=${Math.round(gap)}`;
}

/** Is the player at the bottom right now? */
function atBottom() {
  const s = scrollEl();
  if (!s) return true;
  return (s.scrollHeight - s.scrollTop - s.clientHeight) <= STICK_SLACK;
}

/**
 * Pin the log to the bottom now, and keep re-pinning over the next two seconds
 * so that late growth cannot strand the newest card below the fold.
 *
 * Does nothing while the player has scrolled up to read back.
 */
function scrollChatToBottom(reason = "", { force = false } = {}) {
  safe("scroll chat", () => {
    const st = ui_.stick;
    if (!st) return;                             // mobile mode is not mounted
    if (!st.on && !force) return;                // the player is reading back
    if (force) st.on = true;

    // Every deferred pin re-checks that THIS mount is still the live one. A
    // retry ladder that outlives unmount would scroll the desktop interface the
    // player has just gone back to — and a stale ladder from a previous mount
    // would fight the current one. Check 28 holds this.
    const pin = () => safe("pin bottom", () => {
      if (ui_.stick !== st) return;
      const s = scrollEl();
      if (!s) return;
      s.scrollTop = s.scrollHeight;
    });

    pin();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(pin);
    for (const ms of STICK_RETRIES) {
      const id = setTimeout(() => {
        pin();
        st.timers.delete(id);
      }, ms);
      st.timers.add(id);
    }
    if (reason) diag(`pin bottom (${reason})`, describeScroll());
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
/* -------------------------------------------------- */
/*  Dice So Nice — the frozen-dice trap                */
/* -------------------------------------------------- */

/**
 * FIELD BUG OF 2026-08-23, the second half of "the chat does not update".
 *
 * Dice So Nice hides every roll card (`dsn-hide` -> display:none !important)
 * until its 3D dice finish rolling — and it drives that animation with the
 * MAIN canvas ticker: `canvas.app.ticker.add(this.animateThrow)`. This module
 * STOPS that ticker off the map tab, to save the phone's battery. Chain the
 * three together and every roll made while mobile mode is on lands in the log
 * fully rendered, scrolled to, counted by our own diagnostics (gap=0!) — and
 * invisible, because DSN's hide never gets lifted by an animation that is
 * frozen mid-air. Turning mobile mode off restarts the ticker, the dice land,
 * and the card pops in: exactly the symptom reported from the field.
 *
 * DSN ships the correct valve itself: `game.dice3d.messageHookDisabled`. With
 * it on, DSN neither hides nor animates (main.js checks it in all three
 * paths). So: raise it on mount, restore the prior value on unmount, and free
 * any card a frozen animation already left hidden. Scoped to THIS browser —
 * everyone else's dice keep rolling in 3D, including this player's own when
 * they go back to the desktop view.
 */
function muzzleDiceSoNice() {
  safe("quiet Dice So Nice", () => {
    const dice3d = game.dice3d;
    if (!dice3d) return;
    ui_.dsn = { prior: dice3d.messageHookDisabled === true };
    dice3d.messageHookDisabled = true;
    // Free any card DSN hid before we mounted and left waiting on a frozen throw.
    let freed = 0;
    for (const el of document.querySelectorAll("#chat .dsn-hide")) {
      el.classList.remove("dsn-hide");
      freed++;
    }
    diag(`Dice So Nice quieted (3D dice off while mobile mode is on)${freed ? ` · freed ${freed} hidden card(s)` : ""}`);
  });
}

function unmuzzleDiceSoNice() {
  safe("restore Dice So Nice", () => {
    if (!ui_.dsn) return;
    if (game.dice3d) game.dice3d.messageHookDisabled = ui_.dsn.prior;
    ui_.dsn = null;
  });
}

function watchChatLog() {
  if (ui_.stick) return;
  safe("watch chat log", () => {
    if (typeof MutationObserver !== "function") {
      pushLog("WARN ", ["MutationObserver missing; live scrolling is OFF"]);
      return;
    }

    const st = ui_.stick = {
      on: true,          // sticking to the bottom
      timers: new Set(),
      mo: null,          // cards arriving
      ro: null,          // the log changing height
      onScroll: null,
      log: null          // the .chat-log we are currently watching
    };

    /* -- the player's own scrolling decides whether we stick ------------- */
    st.onScroll = () => safe("chat scrolled", () => {
      const was = st.on;
      st.on = atBottom();
      if (was !== st.on) diag(`stick ${st.on ? "ON (back at the bottom)" : "OFF (reading back)"}`, describeScroll());
    });

    /* -- re-pin whenever the log changes HEIGHT --------------------------
       This is the part that makes it reliable. A card is inserted at its
       pre-image height and grows afterwards; every earlier version scrolled
       once, at insertion, and was left above the card. A height change is the
       real signal, and it fires however the growth was caused. */
    const bindLog = () => safe("bind chat log", () => {
      const log = document.querySelector("#chat .chat-log");
      if (!log || log === st.log) return;
      st.log = log;
      st.ro?.disconnect();
      if (typeof ResizeObserver === "function") {
        st.ro = new ResizeObserver(() => {
          if (st.on) scrollChatToBottom();
        });
        st.ro.observe(log);
      }
      pushLog("INFO ", [`watching the chat log (${log.childElementCount} card(s))`]);
    });

    /* -- cards arriving, and the log element being replaced ---------------
       We observe #chat with subtree:true rather than the <ol> itself: Foundry
       re-renders the log part on some state changes, and an observer bound to
       the old <ol> would sit on a detached node, silently doing nothing for
       the rest of the session. */
    const chat = document.querySelector("#chat");
    if (!chat) {
      pushLog("WARN ", ["#chat not found; live scrolling is OFF"]);
      return;
    }
    st.mo = new MutationObserver(records => safe("chat mutated", () => {
      let cards = 0;
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches?.("[data-message-id]")) {
            cards++;
            // Belt and braces: messageHookDisabled should prevent this, but a
            // card that arrives already hidden by DSN would be invisible with
            // the animation ticker stopped. While mobile mode is on, no card
            // stays hidden.
            if (n.classList.contains("dsn-hide")) n.classList.remove("dsn-hide");
          }
          if (n.matches?.(".chat-log") || n.querySelector?.(".chat-log")) bindLog();
        }
      }
      if (!cards) return;
      scrollChatToBottom(`${cards} card(s) arrived`);
    }));
    st.mo.observe(chat, { childList: true, subtree: true });

    bindLog();
    scrollEl()?.addEventListener("scroll", st.onScroll, { passive: true });
  });
}

/**
 * Make sure a new message actually lands in the log — and put it there
 * ourselves if it does not.
 *
 * Foundry renders a chat card through a chain of hooks that every module is
 * free to join. If one of them throws, the card is never appended, and the
 * player sees nothing until a reload rebuilds the log from the database. The
 * field log of 2026-08-22 shows exactly that shape of failure on the player's
 * client:
 *
 *     chat-portrait | Impossible to get message user
 *     The renderChatMessage hook is deprecated ... at SwadeChatMessage.renderHTML
 *
 * This module cannot fix other people's modules. What it can do is refuse to
 * let the chat — the whole point of the product — depend on all of them
 * behaving. So: wait a moment, and if the card is not there, build it from
 * `ChatMessage#renderHTML()` and append it. If even that fails, fall back to a
 * plain card with author and content, because a plain card beats silence.
 */
async function ensureCardLands(message, delay = 800) {
  const id = message?.id;
  if (!id) return;
  const logEl = () => document.querySelector("#chat .chat-log");
  const present = () => !!logEl()?.querySelector(`[data-message-id="${id}"]`);
  const before = logEl()?.childElementCount ?? -1;

  await new Promise(r => setTimeout(r, delay));

  if (present()) {
    diag(`message ${id}: Foundry rendered it`, `log ${before} -> ${logEl()?.childElementCount}`, describeScroll());
    scrollChatToBottom(`card ${id} landed`);
    return;
  }

  diag(`message ${id}: NO CARD after ${delay}ms — recovering`, describeChat(id));

  const card = await safeAsync("render the card ourselves", () => message.renderHTML());
  const target = logEl();
  if (!target || present()) return;

  if (card) {
    target.append(card);
    diag(`message ${id}: recovered with renderHTML()`);
  } else {
    // Last resort. Ugly, but readable — and readable beats absent.
    const plain = el("li", {
      class: "chat-message message flexcol msp-rescued",
      "data-message-id": id
    });
    plain.append(el("header", { class: "message-header" },
      el("h4", { class: "message-sender", text: message.alias ?? message.author?.name ?? "—" })));
    plain.append(el("div", { class: "message-content", html: message.content ?? "" }));
    target.append(plain);
    diag(`message ${id}: renderHTML() FAILED too; showed a plain card`);
  }
  scrollChatToBottom(`card ${id} recovered`, { force: true });
}

function unwatchChatLog() {
  safe("unwatch chat log", () => {
    const st = ui_.stick;
    if (!st) return;
    st.mo?.disconnect();
    st.ro?.disconnect();
    for (const id of st.timers) clearTimeout(id);
    st.timers.clear();
    if (st.onScroll) scrollEl()?.removeEventListener("scroll", st.onScroll);
    ui_.stick = null;
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
  applyDeviceScale();
  instrumentChat();
  muzzleDiceSoNice();
  enableCanvasGestures();
  watchChatLog();
  diag("mounted", describeChat());
  scrollChatToBottom("mounted", { force: true });

  const onMessage = (msg) => safe("new message", () => {
    diag(`createChatMessage(${msg?.id ?? "?"})`, `author=${msg?.author?.name ?? "?"}`, describeChat(msg?.id));
    flagChatPip();
    // A message of our own means the player is done typing: put the field away.
    if (msg?.author?.id === game.user?.id) showChatForm(false);
    // Do not trust the render chain: check that the card lands, and place it
    // ourselves if it does not. See ensureCardLands().
    safeAsync("ensure the card lands", () => ensureCardLands(msg));
  });
  Hooks.on("createChatMessage", onMessage);
  ui_.hooks.push(["createChatMessage", onMessage]);

  const refresh = () => safe("rebuild the rail", () => {
    const fresh = buildRail();
    ui_.rail?.replaceWith(fresh);
    ui_.rail = fresh;
  });
  /* D-WOUNDS-01, 2026-08-25: the three effect hooks are NOT decoration. Being
     Incapacitated is an ActiveEffect, not a field on the actor, so it never
     fires `updateActor` — without these the skull would only appear on the next
     unrelated change, and the rail would keep showing a healthy character who is
     already down. The same holds for Shaken and every other SWADE status. */
  for (const h of ["updateActor", "createItem", "deleteItem", "updateItem",
                   "createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
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
    restoreDeviceScale();
    disableCanvasGestures();
    unmuzzleDiceSoNice();
    uninstrumentChat();
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
/**
 * D-TOGGLE-01 — the other half: a button on Foundry's own sidebar tab rail
 * that turns mobile mode on with one click.
 *
 * DELIBERATE AMENDMENT to the born-inert principle, requested by Mario on
 * 2026-08-23: while `enabled` is false the module still adds exactly ONE
 * element — this button — because a switch that only exists after you flip it
 * is no switch at all. Everything else remains inert. The button lives inside
 * `#sidebar-tabs`, which Foundry re-renders freely, so it is re-injected on
 * every `renderSidebar`; the id check keeps it single. In mobile mode the
 * whole tab rail is hidden by our CSS, so the button needs no special casing.
 */
function injectViewToggle() {
  safe("view toggle", () => {
    if (document.querySelector("#msp-to-mobile")) return;
    // Mario's layout puts the switch at the FOOT of the LEFT control column —
    // on a phone or tablet, thumb and eye find the left rail first. v0.1.12
    // put it on the right sidebar tab rail by mistake; the right rail remains
    // only as the fallback for a world without scene controls (noCanvas).
    const home = document.querySelector("#scene-controls-layers")
      ?? document.querySelector("#scene-controls menu")
      ?? document.querySelector("#sidebar-tabs menu")
      ?? document.querySelector("#sidebar > nav.tabs menu");
    if (!home) return;
    // D-TOGGLE-02, 2026-08-25: the class list stays as it is, deliberately.
    // While chasing the toggle's size I wrote a version that copied the class
    // list the neighbouring controls share, on the theory that Foundry was
    // handing our button a different box. The real cause turned out to be a
    // hard-coded `width: 22px` in our own stylesheet (see D-TOGGLE-02 there),
    // and the class theory was never confirmed — the offline bench has no icon
    // font, so a sibling's true width could not be measured there. Changing a
    // working element on an unverified theory is how this project has been
    // burned before, so it is reverted and recorded instead.
    home.append(el("li", {},
      el("button", {
        type: "button",
        id: "msp-to-mobile",
        class: "ui-control plain icon",
        "aria-label": t("MSP.Toggle.ToMobile", "Switch to mobile view"),
        onclick: () => safe("turn mobile mode on", () => game.settings.set(MOD, "enabled", true))
      }, el("img", { src: `modules/${MOD}/icons/icon-mob-view-mld.svg`, alt: "" }))
    ));
  });
}

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

    game.settings.register(MOD, "uiSize", {
      name: "MSP.Settings.UiSize.Name",
      hint: "MSP.Settings.UiSize.Hint",
      scope: "client",
      config: true,
      type: Number,
      choices: { 0.8: "MSP.Settings.UiSize.Smaller", 1: "MSP.Settings.UiSize.Normal",
                 1.25: "MSP.Settings.UiSize.Larger", 1.5: "MSP.Settings.UiSize.Largest" },
      default: 1,
      onChange: () => safe("onChange uiSize", () => {
        if (document.body.classList.contains(BODY_CLASS)) applyDeviceScale();
      })
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
    // D-TOGGLE-01: the one element that exists while the module is off.
    injectViewToggle();
    Hooks.on("renderSceneControls", injectViewToggle);
    Hooks.on("renderSidebar", injectViewToggle);
    if (setting("enabled") === true) mount();
    else await maybeAsk();
  });
});

// Exposed for console debugging only, should we need it.
globalThis.MobileSimplePlay = { mount, unmount, setTab, openTargetPicker, openHotbar, saveLog, maybeAsk, logBuffer };
