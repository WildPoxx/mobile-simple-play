/**
 * Mobile Simple Play — v0.1.0
 *
 * PRINCIPIO DE SEGURANCA DESTA VERSAO, e vale ler antes de mexer:
 *
 *   O modulo NASCE INERTE. Enquanto a configuracao `enabled` for falsa — que
 *   e' o padrao — ele nao acrescenta um no' de DOM, nao troca uma classe do
 *   nucleo, nao registra um ouvinte. A unica coisa que ele faz ao carregar e'
 *   declarar tres configuracoes.
 *
 *   `enabled` e' de escopo "client": mora no localStorage DAQUELE navegador.
 *   Ligar no celular nao muda absolutamente nada para o Mestre nem para os
 *   demais jogadores, nem para o mesmo jogador em outro aparelho.
 *
 *   Tudo o que corre depois esta' dentro de try/catch. Um erro nosso vira uma
 *   linha no console, nunca um mundo que nao abre.
 *
 * ESCOLHA DE ARQUITETURA: v0.1 e' CSS-FIRST.
 *   Nao substituimos CONFIG.ui.chat nem nenhuma classe do nucleo. Mexemos em
 *   classe de <body> e acrescentamos elementos NOSSOS. E' menos poderoso e
 *   muito mais seguro para uma primeira versao que vai rodar em campanha viva.
 */

const MOD = "mobile-simple-play";
const BODY_CLASS = "msp-on";

/** Pericias que entram no trilho quando o jogador nao configurou nada.
 *  As cinco centrais do SWADE mais as duas de combate mais usadas. */
const DEFAULT_SKILLS = [
  "Athletics", "Atletismo",
  "Common Knowledge", "Conhecimentos Gerais", "Conhecimento Comum",
  "Notice", "Perceber", "Notar",
  "Persuasion", "Persuasão", "Persuasao",
  "Stealth", "Furtividade",
  "Fighting", "Lutar", "Luta",
  "Shooting", "Atirar", "Tiro"
];

/** Registro dos nossos elementos, para conseguirmos desmontar tudo. */
const ui_ = { rail: null, bar: null, sheet: null, overlay: null, hooks: [] };

/* -------------------------------------------------- */
/*  Utilidades curtas                                  */
/* -------------------------------------------------- */

const log = (...a) => console.log(`${MOD} |`, ...a);
const warn = (...a) => console.warn(`${MOD} |`, ...a);

/** Envolve qualquer coisa nossa. Nada daqui pode derrubar o mundo. */
function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    warn(`falha em "${label}" — o modulo segue, o Foundry segue.`, err);
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

/** O ator do jogador. Sem canvas, sem token: e' o personagem atribuido. */
function myActor() {
  return safe("myActor", () => game.user?.character ?? null) ?? null;
}

/* -------------------------------------------------- */
/*  Toque longo — mostra o nome do item                */
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
/*  Trilho de acoes                                    */
/* -------------------------------------------------- */

function chosenSkills(actor) {
  const raw = (setting("skills") ?? "").trim();
  const wanted = raw
    ? raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_SKILLS.map(s => s.toLowerCase());
  const skills = actor.items.filter(i => i.type === "skill");
  const picked = skills.filter(s => wanted.includes(s.name.trim().toLowerCase()));
  // Sem correspondencia nenhuma? Melhor mostrar as primeiras que nada.
  return (picked.length ? picked : skills).slice(0, 8);
}

function favouriteItems(actor) {
  return actor.items.filter(i => {
    const fav = i.system?.favorite === true;
    const kind = ["weapon", "power", "consumable", "gear", "action", "shield"].includes(i.type);
    return fav && kind;
  });
}

function railButton({ img, label, cls, onClick }) {
  const btn = el("button", {
    type: "button",
    class: `msp-slot ${cls ?? ""}`,
    "aria-label": label,
    onclick: (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      safe(`acao "${label}"`, onClick);
    }
  });
  if (img) btn.append(el("img", { src: img, alt: "" }));
  else btn.append(el("i", { class: "fa-solid fa-dice-d20" }));
  attachLongPress(btn, label);
  return btn;
}

function buildRail() {
  const actor = myActor();
  const rail = el("nav", { id: "msp-rail", "aria-label": "Ações" });

  if (!actor) {
    rail.append(el("div", { class: "msp-empty", text: "—" }));
    return rail;
  }

  const top = el("div", { class: "msp-rail-top" });

  // ARMAS E ITENS FAVORITOS — no topo, como no mockup de Mario.
  for (const item of favouriteItems(actor)) {
    top.append(railButton({
      img: item.img,
      label: item.name,
      cls: "msp-item",
      onClick: () => item.show?.()
    }));
  }

  if (top.childElementCount) top.append(el("hr", { class: "msp-div" }));

  // PERICIAS
  for (const skill of chosenSkills(actor)) {
    top.append(railButton({
      img: skill.img,
      label: skill.name,
      cls: "msp-skill",
      onClick: () => actor.rollSkill?.(skill.id, {})
    }));
  }

  rail.append(top);

  // PE' DO TRILHO: estado (so' leitura) e alvo.
  const foot = el("div", { class: "msp-rail-foot" });
  foot.append(buildStatusBadges(actor));
  foot.append(railButton({
    label: "Alvo",
    cls: "msp-target",
    onClick: openTargetPicker
  }));
  // o icone do alvo e' proprio
  foot.querySelector(".msp-target i")?.setAttribute("class", "fa-solid fa-crosshairs");
  rail.append(foot);

  return rail;
}

function buildStatusBadges(actor) {
  const box = el("div", { class: "msp-status" });
  const add = (label, value, cls) => {
    box.append(el("div", { class: `msp-badge ${cls}`, "aria-label": label, text: String(value) }));
  };
  safe("selos de estado", () => {
    const sys = actor.system ?? {};
    const w = sys.wounds;
    const f = sys.fatigue;
    const b = sys.bennies;
    if (w) add("Ferimentos", `${w.value ?? 0}/${w.max ?? 0}`, "msp-wounds");
    if (f) add("Fadiga", `${f.value ?? 0}/${f.max ?? 0}`, "msp-fatigue");
    if (b) add("Bennies", `${b.value ?? 0}`, "msp-bennies");
  });
  return box;
}

/* -------------------------------------------------- */
/*  Escolha de alvo — funciona COM e SEM canvas        */
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
  return safe("alvos atuais", () => new Set([...(game.user?.targets ?? [])].map(t => t.id))) ?? new Set();
}

function applyTargets(ids) {
  safe("marcar alvo", () => {
    const list = [...ids];
    if (canvas?.ready && canvas?.tokens) {
      canvas.tokens.setTargets(list, { mode: "replace" });
    } else {
      // Sem canvas: a metade que importa e' puro socket.
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

  if (!list.childElementCount) list.append(el("p", { class: "msp-empty", text: "Nenhum token nesta cena." }));

  openOverlay("Alvo", list, [
    { label: "Limpar", onClick: () => { chosen.clear(); applyTargets(chosen); closeOverlay(); } },
    { label: "Fechar", onClick: closeOverlay, primary: true }
  ]);
}

/* -------------------------------------------------- */
/*  Sobreposicao generica                              */
/* -------------------------------------------------- */

function openOverlay(title, content, buttons = []) {
  closeOverlay();
  const foot = el("footer", { class: "msp-overlay-foot" });
  for (const b of buttons) {
    foot.append(el("button", {
      type: "button",
      class: b.primary ? "msp-primary" : "",
      text: b.label,
      onclick: () => safe(`botao "${b.label}"`, b.onClick)
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
/*  Barra unica de baixo                               */
/* -------------------------------------------------- */

function setTab(tab) {
  safe("trocar de aba", () => {
    document.body.dataset.mspTab = tab;
    for (const b of ui_.bar?.querySelectorAll("[data-msp-tab]") ?? []) {
      b.classList.toggle("is-active", b.dataset.mspTab === tab);
    }
    // Ao sair do mapa, poupar bateria: parar o relogio de animacao do PIXI.
    safe("ticker do PIXI", () => {
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
  const bar = el("nav", { id: "msp-bar", "aria-label": "Navegação" });

  bar.append(tabButton("chat", "fa-solid fa-comments", "Chat"));
  if (safe("canvas existe?", () => !game.settings.get("core", "noCanvas")) ?? false) {
    bar.append(tabButton("map", "fa-solid fa-map", "Mapa"));
  }

  // Botao do PC — acao, nunca "aceso".
  const actor = myActor();
  const pc = el("button", {
    type: "button",
    id: "msp-pc",
    "aria-label": actor?.name ?? "Personagem",
    onclick: () => safe("abrir ficha", () => myActor()?.sheet?.render(true))
  });
  if (actor?.img) pc.append(el("img", { src: actor.img, alt: "" }));
  else pc.append(el("i", { class: "fa-solid fa-user" }));
  bar.append(pc);

  // "Mais" — escrever no chat e hotbar.
  bar.append(el("button", {
    type: "button",
    class: "msp-more",
    "aria-label": "Mais",
    onclick: openMore
  }, el("i", { class: "fa-solid fa-ellipsis" })));

  return bar;
}

function openMore() {
  const box = el("div", { class: "msp-more-list" });
  box.append(el("button", {
    type: "button", text: "Escrever no chat",
    onclick: () => { closeOverlay(); toggleChatForm(true); }
  }));
  box.append(el("button", {
    type: "button", text: "Hotbar",
    onclick: () => { closeOverlay(); toggleHotbar(); }
  }));
  box.append(el("button", {
    type: "button", text: "Desligar o modo celular",
    onclick: () => { closeOverlay(); disableAndReload(); }
  }));
  openOverlay("Mais", box, [{ label: "Fechar", onClick: closeOverlay, primary: true }]);
}

function toggleChatForm(show) {
  safe("campo de mensagem", () => {
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
/*  Aviso de mensagem nova                             */
/* -------------------------------------------------- */

function flagChatPip() {
  if ((document.body.dataset.mspTab ?? "chat") === "chat") return;
  ui_.bar?.querySelector(".msp-pip")?.removeAttribute("hidden");
}

function clearChatPip() {
  ui_.bar?.querySelector(".msp-pip")?.setAttribute("hidden", "hidden");
}

/* -------------------------------------------------- */
/*  Ligar e desligar                                   */
/* -------------------------------------------------- */

function mount() {
  if (document.body.classList.contains(BODY_CLASS)) return;
  log("ligando o modo celular neste navegador.");
  document.body.classList.add(BODY_CLASS);

  ui_.rail = buildRail();
  ui_.bar = buildBar();
  document.body.append(ui_.rail, ui_.bar);
  setTab("chat");

  const onMessage = () => safe("aviso de mensagem", flagChatPip);
  Hooks.on("createChatMessage", onMessage);
  ui_.hooks.push(["createChatMessage", onMessage]);

  const refresh = () => safe("refazer o trilho", () => {
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
  safe("desmontar", () => {
    document.body.classList.remove(BODY_CLASS, "msp-writing", "msp-hotbar");
    delete document.body.dataset.mspTab;
    ui_.rail?.remove(); ui_.rail = null;
    ui_.bar?.remove(); ui_.bar = null;
    closeOverlay();
    for (const [hook, fn] of ui_.hooks) Hooks.off(hook, fn);
    ui_.hooks.length = 0;
    safe("religar o ticker", () => canvas?.app?.ticker?.start());
  });
}

async function disableAndReload() {
  await safe("desligar", async () => {
    await game.settings.set(MOD, "enabled", false);
    unmount();
  });
}

/** Pergunta uma unica vez, e so' em tela de toque. Pedir, nunca impor. */
async function maybeAsk() {
  if (setting("asked") === true) return;
  if (!isTouch()) return;
  await safe("pergunta inicial", async () => {
    await game.settings.set(MOD, "asked", true);
    const D = foundry.applications.api.DialogV2;
    const yes = await D.confirm({
      window: { title: "Mobile Simple Play" },
      content: `<p>Este aparelho parece ser um celular ou tablet.</p>
                <p>Ativar o <strong>modo celular</strong> neste navegador?
                Ele só vale aqui — não muda nada para os outros jogadores,
                e você pode desligar a qualquer momento pelo botão <em>Mais</em>.</p>`,
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
/*  Entrada                                            */
/* -------------------------------------------------- */

Hooks.once("init", () => {
  safe("registrar configuracoes", () => {
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
  log("carregado, inerte. Nada acontece ate' alguem ligar.");
});

Hooks.once("ready", () => {
  safe("ready", async () => {
    if (setting("enabled") === true) mount();
    else await maybeAsk();
  });
});

// Exposto so' para depuracao a partir do console, se precisarmos.
globalThis.MobileSimplePlay = { mount, unmount, setTab, openTargetPicker };
