/**
 * Mobile Simple Play — v0.1.1
 *
 * SAFETY PRINCIPLE OF THIS VERSION — read this before touching anything:
 *
 *   THE MODULE IS BORN INERT. While the `enabled` setting is false — and it is
 *   false by default — it adds no DOM node, swaps no core class, and registers
 *   no listener. The only thing it does on load is declare three settings.
 *
 *   `enabled` is "client" scope: it lives in the localStorage of THAT browser.
 *   Turning it on from a phone changes nothing for the GM, for the other
 *   players, or for the same player on another device.
 *
 *   Everything that runs afterwards is wrapped in try/catch. A bug of ours
 *   becomes a console line, never a world that will not open.
 *
 * ARCHITECTURAL CHOICE: v0.1 IS CSS-FIRST.
 *   We do not replace CONFIG.ui.chat or any other core class. We toggle a
 *   <body> class and append elements of OUR OWN. Less powerful, and far safer
 *   for a first version that runs in a live campaign.
 */

const MOD = "mobile-simple-play";
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

/** Registry of our own elements, so we can tear everything down. */
const ui_ = { rail: null, bar: null, sheet: null, overlay: null, hooks: [] };

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
  return safe("current targets", () => new Set([...(game.user?.targets ?? [])].map(t => t.id))) ?? new Set();
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
    if (tab === "chat") clearChatPip();
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

  // "More" — write in chat, hotbar, turn off.
  bar.append(el("button", {
    type: "button",
    class: "msp-more",
    "aria-label": t("MSP.More.Label", "More"),
    onclick: openMore
  }, el("i", { class: "fa-solid fa-ellipsis" })));

  return bar;
}

function openMore() {
  const box = el("div", { class: "msp-more-list" });
  box.append(el("button", {
    type: "button", text: t("MSP.More.Write", "Write in chat"),
    onclick: () => { closeOverlay(); toggleChatForm(true); }
  }));
  box.append(el("button", {
    type: "button", text: t("MSP.More.Hotbar", "Hotbar"),
    onclick: () => { closeOverlay(); toggleHotbar(); }
  }));
  box.append(el("button", {
    type: "button", text: t("MSP.More.Disable", "Turn off mobile mode"),
    onclick: () => { closeOverlay(); disableAndReload(); }
  }));
  openOverlay(t("MSP.More.Label", "More"), box, [
    { label: t("MSP.Common.Close", "Close"), onClick: closeOverlay, primary: true }
  ]);
}

function toggleChatForm(show) {
  safe("message field", () => {
    document.body.classList.toggle("msp-writing", show);
    if (show) {
      const form = document.querySelector("#chat .chat-form");
      form?.scrollIntoView({ block: "end" });
      form?.querySelector("textarea, input, [contenteditable='true'], .editor-content")?.focus?.();
    }
  });
}

function toggleHotbar() {
  safe("hotbar", () => document.body.classList.toggle("msp-hotbar"));
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
/*  Turning on and off                                 */
/* -------------------------------------------------- */

function mount() {
  if (document.body.classList.contains(BODY_CLASS)) return;
  log("turning mobile mode on in this browser.");
  document.body.classList.add(BODY_CLASS);

  ui_.rail = buildRail();
  ui_.bar = buildBar();
  document.body.append(ui_.rail, ui_.bar);
  setTab("chat");

  const onMessage = () => safe("new-message pip", flagChatPip);
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
}

function unmount() {
  safe("unmount", () => {
    document.body.classList.remove(BODY_CLASS, "msp-writing", "msp-hotbar");
    delete document.body.dataset.mspTab;
    ui_.rail?.remove(); ui_.rail = null;
    ui_.bar?.remove(); ui_.bar = null;
    closeOverlay();
    for (const [hook, fn] of ui_.hooks) Hooks.off(hook, fn);
    ui_.hooks.length = 0;
    safe("restart the ticker", () => canvas?.app?.ticker?.start());
  });
}

async function disableAndReload() {
  await safe("turn off", async () => {
    await game.settings.set(MOD, "enabled", false);
    unmount();
  });
}

/** Asks exactly once, and only on a touch screen. Offer, never impose. */
async function maybeAsk() {
  if (setting("asked") === true) return;
  if (!isTouch()) return;
  await safe("first-run prompt", async () => {
    await game.settings.set(MOD, "asked", true);
    const D = foundry.applications.api.DialogV2;
    const yes = await D.confirm({
      window: { title: "Mobile Simple Play" },
      content: `<p>${t("MSP.Prompt.Detected", "This device looks like a phone or a tablet.")}</p>
                <p>${t("MSP.Prompt.Question", "Turn on <strong>mobile mode</strong> in this browser? It applies here only — it changes nothing for the other players, and you can turn it off at any time from the <em>More</em> button.")}</p>`,
      rejectClose: false,
      modal: true
    });
    if (yes) {
      await game.settings.set(MOD, "enabled", true);
      mount();
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

    game.settings.register(MOD, "asked", {
      scope: "client",
      config: false,
      type: Boolean,
      default: false
    });
  });
  log("loaded, inert. Nothing happens until someone turns it on.");
});

Hooks.once("ready", () => {
  safe("ready", async () => {
    if (setting("enabled") === true) mount();
    else await maybeAsk();
  });
});

// Exposed for console debugging only, should we need it.
globalThis.MobileSimplePlay = { mount, unmount, setTab, openTargetPicker };
