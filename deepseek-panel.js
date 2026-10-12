/*
 * DeepSeek Dashboard (mini) - injected panel for the OpenCode desktop UI.
 *
 * Loaded by patching resources/app.asar (see apply.js). No dependencies.
 *
 * Data comes from the DeepSeek Platform account session (NOT the API key):
 *   - Login: opens a real DeepSeek sign-in window (main process captures the
 *     session Bearer token). A custom email/password POST cannot work because
 *     the login endpoint is behind an AWS WAF challenge.
 *   - Usage: platform.deepseek.com/api/v0/* is called from the main process
 *     (Node, no CORS) via window.api.deepseek*.
 *
 * Style: flat, OpenCode-first (no gradients / glow), DeepSeek accent only.
 */
(function () {
  "use strict";

  if (window.__deepseekPanelLoaded) return;
  window.__deepseekPanelLoaded = true;

  var LOGO_PATH = "__DEEPSEEK_LOGO_PATH__";
  var CARD_MAX_W = 690;
  var CARD_MIN_W = 360;
  var DASHBOARD_URL = "https://platform.deepseek.com/usage";

  // Language: OpenCode / system language, English fallback. No strings are
  // hardcoded in a specific language outside this table.
  var LOCALE = (function () {
    function pick(v) {
      v = String(v || "").toLowerCase();
      if (v.indexOf("it") === 0) return "it";
      if (v.indexOf("en") === 0) return "en";
      return null;
    }
    // System language first, then OpenCode's selected language, English fallback.
    return pick(navigator.language) || pick(document.documentElement && document.documentElement.getAttribute("lang")) || "en";
  })();
  var I18N = {
    en: {
      login_title: "Sign in to DeepSeek",
      login_desc: "Sign in with your DeepSeek Platform account to see balance, cost, tokens and usage history.",
      login_button: "Sign in with DeepSeek",
      login_fine: "A DeepSeek window will open. The session is stored on this device.",
      logging: "Complete the login in the DeepSeek window...",
      balance: "Available balance",
      total_cost: "Total cost",
      cost: "Cost",
      requests: "API requests",
      tokens: "Tokens",
      no_data: "No data in this period.",
      reset: "Clear filters",
      refresh: "Refresh",
      all_keys: "All API keys",
      dashboard: "Dashboard",
      logout: "Logout",
      confirm_msg: "Do you really want to sign out of DeepSeek?",
      cancel: "Cancel",
      close: "Close",
      apply: "Apply",
      err_data: "Could not load data.",
      err_login: "Login not completed.",
      err_network: "Login error.",
      preset_today: "Today",
      preset_yesterday: "Yesterday",
      preset_7d: "Last 7 days",
      preset_30d: "Last 30 days",
      preset_thisMonth: "This month",
      preset_lastMonth: "Last month",
      preset_custom: "Custom"
    },
    it: {
      login_title: "Accedi a DeepSeek",
      login_desc: "Accedi con il tuo account DeepSeek Platform per vedere saldo, costo, token e storico di utilizzo.",
      login_button: "Accedi con DeepSeek",
      login_fine: "Si aprira' una finestra DeepSeek. La sessione resta salvata sul dispositivo.",
      logging: "Completa il login nella finestra DeepSeek...",
      balance: "Saldo disponibile",
      total_cost: "Costo totale",
      cost: "Costo",
      requests: "Richieste API",
      tokens: "Token",
      no_data: "Nessun dato nel periodo.",
      reset: "Azzera filtri",
      refresh: "Aggiorna",
      all_keys: "Tutte le API key",
      dashboard: "Dashboard",
      logout: "Logout",
      confirm_msg: "Vuoi davvero uscire dall'account DeepSeek?",
      cancel: "Annulla",
      close: "Chiudi",
      apply: "Applica",
      err_data: "Errore nel recupero dei dati.",
      err_login: "Login non completato.",
      err_network: "Errore di login.",
      preset_today: "Oggi",
      preset_yesterday: "Ieri",
      preset_7d: "Ultimi 7 giorni",
      preset_30d: "Ultimi 30 giorni",
      preset_thisMonth: "Questo mese",
      preset_lastMonth: "Mese scorso",
      preset_custom: "Personalizzato"
    }
  };
  function t(key) {
    var dict = I18N[LOCALE] || I18N.en;
    if (dict[key] != null) return dict[key];
    if (I18N.en[key] != null) return I18N.en[key];
    return key;
  }

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var currencySymbol = { USD: "$", CNY: "\u00a5" };

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        var value = props[key];
        if (value == null) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key === "on" && typeof value === "object") { for (var evt in value) node.addEventListener(evt, value[evt]); }
        else node.setAttribute(key, value);
      }
    }
    if (children) for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function svgMark(size) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 40 40");
    svg.setAttribute("class", "dsp-mark");
    svg.setAttribute("aria-hidden", "true");
    if (LOGO_PATH && LOGO_PATH.indexOf("__") !== 0) {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", LOGO_PATH);
      p.setAttribute("fill", "currentColor");
      svg.appendChild(p);
    }
    return svg;
  }

  function fmtInt(n) { return (n || 0).toLocaleString("it-IT"); }
  function fmtAmount(v, currency) {
    var sym = currencySymbol[currency] || "";
    var num = typeof v === "number" ? v : parseFloat(v);
    if (isNaN(num)) num = 0;
    var s = num.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sym ? sym + s : s + " " + currency;
  }
  function toInt(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function apiKeysFrom(raw) {
    if (!raw || !raw.length) return [];
    return raw.map(function (k) { var id = k.tracking_id || k.sensitive_id || k.name; return { id: id, name: k.name || id }; }).filter(function (k) { return !!k.id; });
  }
  function mergeKeys(a, b) {
    var map = {};
    (a || []).concat(b || []).forEach(function (k) { if (k && k.id) map[k.id] = k.name || k.id; });
    return Object.keys(map).map(function (id) { return { id: id, name: map[id] }; });
  }
  function friendlyError(e) {
    if (!e || /JSON|Unexpected/i.test(e)) return t("err_data");
    return e;
  }

  // ---- API bridge (added to preload by apply.js) --------------------------
  function bridge() { return window.api || {}; }
  function dsStatus() { var b = bridge(); return b.deepseekStatus ? b.deepseekStatus() : Promise.resolve({ ok: false }); }
  function dsLogin() { var b = bridge(); return b.deepseekLogin ? b.deepseekLogin() : Promise.reject(new Error("bridge mancante")); }
  function dsRestore() { var b = bridge(); return b.deepseekRestore ? b.deepseekRestore() : Promise.resolve({ ok: false }); }
  function dsLogout() { var b = bridge(); return b.deepseekLogout ? b.deepseekLogout() : Promise.resolve(); }
  function dsUsage(params) { var b = bridge(); return b.deepseekUsage ? b.deepseekUsage(params) : Promise.reject(new Error("bridge mancante")); }

  // ---- CSS (flat, no gradients/glow) ---------------------------------------
  var CSS = [
    "#deepseek-panel-card,.dsp-rail-btn,.dsp-float-btn{--dsp-accent:#4d6bfe;--dsp-accent-soft:rgba(77,107,254,.14)}",
    "#deepseek-panel-card *{box-sizing:border-box}",
    "#deepseek-panel-card button{font:inherit;color:inherit}",
    ".dsp-rail-btn{position:relative;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:9px;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-weak,#8f8f8f);transition:background .14s ease,color .14s ease}",
    ".dsp-rail-btn:hover{background:var(--surface-base-hover,rgba(255,255,255,.07));color:var(--text-strong,#e8e8e8)}",
    ".dsp-rail-btn.dsp-active{color:var(--dsp-accent);background:var(--dsp-accent-soft)}",
    ".dsp-rail-btn .dsp-mark{width:18px;height:18px;display:block;flex:none}",
    ".dsp-float-btn{position:fixed;left:10px;bottom:10px;z-index:2147483600;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;border:1px solid var(--border-base,rgba(255,255,255,.14));background:var(--background-strong,#1b1b1b);cursor:pointer;color:var(--text-strong,#e8e8e8);box-shadow:0 1px 2px rgba(0,0,0,.25)}",
    ".dsp-float-btn .dsp-mark{width:18px;height:18px;color:var(--dsp-accent)}",
    ".dsp-title,.dsp-dot{display:none}",
    ".dsp-card{position:fixed;z-index:2147483600;display:none;width:" + CARD_MIN_W + "px;max-height:calc(100vh - 120px);border-radius:12px;border:1px solid var(--border-base,rgba(255,255,255,.14));background:var(--background-strong,#1b1b1b);box-shadow:0 2px 4px rgba(0,0,0,.2),0 16px 40px -16px rgba(0,0,0,.6);font-family:var(--font-sans,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);font-size:13px;line-height:1.45;color:var(--text-strong,#e8e8e8);overflow:hidden;flex-direction:column}",
    ".dsp-card.dsp-open{display:flex}",
    ".dsp-head{display:flex;align-items:center;justify-content:space-between;padding:11px 12px 10px;border-bottom:1px solid var(--border-weak-base,rgba(255,255,255,.08));flex:none}",
    ".dsp-head-brand{display:flex;align-items:center;gap:8px;font-weight:600}",
    ".dsp-head-brand .dsp-mark{width:18px;height:18px;display:block;color:var(--dsp-accent)}",
    ".dsp-head-left{display:flex;align-items:center;gap:6px}",
    ".dsp-ico{width:15px;height:15px;display:block}",
    ".dsp-ico-ext{width:13px;height:13px;opacity:.85}",
    ".dsp-spin{animation:dsp-rotate .8s linear infinite}",
    "@keyframes dsp-rotate{to{transform:rotate(360deg)}}",
    ".dsp-status-dot{position:absolute;top:-1px;right:-1px;width:9px;height:9px;border-radius:50%;display:none;z-index:2;box-shadow:0 0 0 1.5px var(--background-base,#121212)}",
    ".dsp-confirm-overlay{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}",
    ".dsp-confirm{width:min(300px,86%);border:1px solid var(--border-base,rgba(255,255,255,.16));border-radius:10px;background:var(--background-strong,#1b1b1b);padding:14px}",
    ".dsp-confirm-title{font-weight:600;margin-bottom:4px}",
    ".dsp-confirm-msg{color:var(--text-weak,#9a9a9a);font-size:12px;margin-bottom:12px}",
    ".dsp-confirm-actions{display:flex;gap:8px}",
    ".dsp-timepanel{display:flex;width:min(620px,94vw);max-height:82vh;border:1px solid var(--border-base,rgba(255,255,255,.16));border-radius:12px;background:var(--background-strong,#1b1b1b);overflow:hidden}",
    ".dsp-cal-presets{width:154px;flex:none;padding:8px;border-right:1px solid var(--border-weak-base,rgba(255,255,255,.08));display:flex;flex-direction:column;gap:2px;overflow:auto}",
    ".dsp-cal-preset{padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;white-space:nowrap}",
    ".dsp-cal-preset:hover{background:var(--surface-base-hover,rgba(255,255,255,.07))}",
    ".dsp-cal-preset.dsp-on{background:var(--surface-base-active,rgba(255,255,255,.1))}",
    ".dsp-cal-main{flex:1;min-width:0;padding:10px 12px;display:flex;flex-direction:column}",
    ".dsp-cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}",
    ".dsp-cal-nav-title{font-weight:600;font-size:13px}",
    ".dsp-cal-months{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1}",
    ".dsp-cal-mtitle{font-weight:600;font-size:12px;text-align:center;margin-bottom:6px;text-transform:capitalize}",
    ".dsp-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}",
    ".dsp-cal-wd{text-align:center;color:var(--text-weak,#9a9a9a);font-size:11px;padding:2px 0}",
    ".dsp-cal-day{text-align:center;padding:6px 0;border-radius:7px;font-size:12px;cursor:pointer}",
    ".dsp-cal-day:not(.dsp-cal-empty):hover{background:var(--surface-base-hover,rgba(255,255,255,.08))}",
    ".dsp-cal-empty{cursor:default}",
    ".dsp-cal-inrange{background:var(--dsp-accent-soft,rgba(77,107,254,.18))}",
    ".dsp-cal-edge{background:var(--dsp-accent);color:#fff}",
    ".dsp-cal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}",
    ".dsp-cal-actions .dsp-ghost{flex:0 0 auto;padding:0 16px}",
    ".dsp-ghost:disabled{opacity:.5;cursor:default}",
    ".dsp-icon-btn{border:0;background:transparent;width:26px;height:26px;border-radius:8px;cursor:pointer;color:var(--text-weak,#8f8f8f);font-size:12px;display:flex;align-items:center;justify-content:center;padding:0}",
    ".dsp-icon-btn:hover{background:var(--surface-base-hover,rgba(255,255,255,.08));color:var(--text-strong,#e8e8e8)}",
    ".dsp-scroll{overflow:auto;flex:1}",
    ".dsp-body{padding:14px}",
    ".dsp-login{display:flex;flex-direction:column;gap:12px;max-width:360px;margin:0 auto;text-align:center}",
    ".dsp-login .dsp-mark{width:44px;height:44px;margin:6px auto 0;display:block;color:var(--dsp-accent)}",
    ".dsp-login h2{margin:0;font-size:16px;font-weight:600}",
    ".dsp-primary{height:38px;border-radius:9px;border:1px solid var(--dsp-accent);background:var(--dsp-accent);color:#fff;font-weight:600;cursor:pointer}",
    ".dsp-primary:hover{background:#3f5cf0}",
    ".dsp-secondary{height:38px;border-radius:9px;border:1px solid var(--border-base,rgba(255,255,255,.16));background:transparent;color:var(--text-strong,#e8e8e8);cursor:pointer}",
    ".dsp-secondary:hover{background:var(--surface-base-hover,rgba(255,255,255,.07))}",
    ".dsp-fine{margin:0;color:var(--text-weaker,#7a7a7a);font-size:11px}",
    ".dsp-muted{color:var(--text-weak,#9a9a9a)}",
    ".dsp-link{color:var(--dsp-accent);text-decoration:none;font-weight:500;cursor:pointer}",
    ".dsp-link:hover{text-decoration:underline}",
    ".dsp-error{border:1px solid rgba(252,83,58,.45);background:rgba(252,83,58,.14);color:#fc8676;border-radius:9px;padding:8px 10px;font-size:12px}",
    ".dsp-row{display:grid;gap:10px}",
    ".dsp-row-2{grid-template-columns:1fr 1fr}",
    ".dsp-row-3{grid-template-columns:1fr 1fr 1fr}",
    ".dsp-cardbox{border:1px solid var(--border-weak-base,rgba(255,255,255,.08));border-radius:10px;background:var(--surface-base,rgba(255,255,255,.03));padding:12px}",
    ".dsp-cardbox .dsp-k{color:var(--text-weak,#9a9a9a);font-size:12px}",
    ".dsp-cardbox .dsp-v{font-size:24px;font-weight:700;letter-spacing:-.01em;margin-top:2px}",
    ".dsp-cardbox .dsp-v-sm{font-size:18px;font-weight:700;margin-top:2px}",
    ".dsp-cardbox .dsp-unit{font-size:12px;font-weight:600;color:var(--text-weak,#9a9a9a);margin-left:6px}",
    ".dsp-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}",
    ".dsp-drop{position:relative}",
    ".dsp-drop-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:9px;border:1px solid var(--border-base,rgba(255,255,255,.16));background:transparent;color:var(--text-strong,#e8e8e8);cursor:pointer;font-size:12px}",
    ".dsp-drop-btn:hover{background:var(--surface-base-hover,rgba(255,255,255,.07))}",
    ".dsp-drop-btn .dsp-caret{color:var(--text-weak,#9a9a9a);font-size:10px}",
    ".dsp-menu{position:absolute;top:38px;left:0;min-width:190px;max-height:280px;overflow:auto;border:1px solid var(--border-base,rgba(255,255,255,.16));border-radius:10px;background:var(--background-strong,#1b1b1b);box-shadow:0 12px 32px -10px rgba(0,0,0,.6);z-index:5;padding:5px;display:none}",
    ".dsp-menu.dsp-menu-open{display:block}",
    ".dsp-menu-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 9px;border-radius:7px;cursor:pointer;white-space:nowrap}",
    ".dsp-menu-item:hover{background:var(--surface-base-hover,rgba(255,255,255,.08))}",
    ".dsp-menu-item .dsp-check{color:var(--dsp-accent)}",
    ".dsp-menu-item .dsp-sub{color:var(--text-weak,#9a9a9a);font-size:11px}",
    ".dsp-sep{height:1px;background:var(--border-weak-base,rgba(255,255,255,.08));margin:5px 0}",
    ".dsp-chart{border:1px solid var(--border-weak-base,rgba(255,255,255,.08));border-radius:10px;background:var(--surface-base,rgba(255,255,255,.03));padding:12px 12px 8px}",
    ".dsp-chart-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}",
    ".dsp-seg{display:inline-flex;border:1px solid var(--border-base,rgba(255,255,255,.16));border-radius:8px;overflow:hidden}",
    ".dsp-seg button{border:0;background:transparent;padding:4px 10px;cursor:pointer;font-size:12px;color:var(--text-weak,#9a9a9a)}",
    ".dsp-seg button.dsp-on{background:var(--surface-base-active,rgba(255,255,255,.1));color:var(--text-strong,#e8e8e8)}",
    ".dsp-maxlabel{color:var(--text-weak,#9a9a9a);font-size:10px;margin-bottom:2px}",
    ".dsp-plot{display:flex;align-items:flex-end;gap:3px;height:150px;border-top:1px solid var(--border-weak-base,rgba(255,255,255,.10));padding-top:2px}",
    ".dsp-col{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center}",
    ".dsp-barfill{width:100%;max-width:26px;background:var(--dsp-accent);border-radius:2px}",
    ".dsp-xrow{display:flex;justify-content:space-between;color:var(--text-weak,#9a9a9a);font-size:10px;margin-top:4px}",
    ".dsp-empty{color:var(--text-weak,#9a9a9a);padding:24px 4px;text-align:center}",
    ".dsp-foot{display:flex;gap:8px;margin-top:12px}",
    ".dsp-ghost{flex:1;height:32px;border-radius:8px;border:1px solid var(--border-base,rgba(255,255,255,.14));background:transparent;cursor:pointer;font-size:12px;color:var(--text-strong,#e8e8e8);display:inline-flex;align-items:center;justify-content:center;gap:6px}",
    ".dsp-ghost:hover{background:var(--surface-base-hover,rgba(255,255,255,.07))}",
    ".dsp-danger:hover{color:#fc8676;border-color:rgba(252,83,58,.5)}",
    ".dsp-spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--border-base,rgba(255,255,255,.2));border-top-color:var(--dsp-accent);animation:dsp-spin .7s linear infinite;margin:24px auto}",
    "@keyframes dsp-spin{to{transform:rotate(360deg)}}",
    ".dsp-date{height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--border-base,rgba(255,255,255,.16));background:transparent;color:var(--text-strong,#e8e8e8);color-scheme:inherit}",
    ".dsp-balance-row{display:flex;align-items:baseline;gap:8px}",
    ".dsp-big{font-size:28px;font-weight:700;letter-spacing:-.01em}",
    ".dsp-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid transparent}",
    ".dsp-pill-ok{background:rgba(18,201,5,.14);color:#4fd23f}",
    ".dsp-pill-warn{background:rgba(251,221,70,.16);color:#e0c23a}"
  ].join("");

  function injectStyles() {
    if (document.getElementById("deepseek-panel-style")) return;
    var style = document.createElement("style");
    style.id = "deepseek-panel-style";
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  var card = el("div", { id: "deepseek-panel-card", class: "dsp-card", role: "dialog", "aria-label": "DeepSeek dashboard", "data-deepseek-panel": "1" });
  var launcher = el("button", { class: "dsp-launcher dsp-rail-btn", type: "button", title: "DeepSeek", "aria-label": "DeepSeek dashboard", "data-deepseek-panel": "1" });
  launcher.appendChild(svgMark());
  launcher.appendChild(el("span", { class: "dsp-title", text: "DeepSeek" }));
  launcher.appendChild(el("span", { class: "dsp-status-dot" }));

  var TIME_PRESETS = [
    { id: "today", label: t("preset_today") },
    { id: "yesterday", label: t("preset_yesterday") },
    { id: "7d", label: t("preset_7d") },
    { id: "30d", label: t("preset_30d") },
    { id: "thisMonth", label: t("preset_thisMonth") },
    { id: "lastMonth", label: t("preset_lastMonth") },
    { id: "custom", label: t("preset_custom") }
  ];

  var state = {
    view: "checking",
    error: "",
    loading: false,
    loggedIn: false,
    confirmLogout: false,
    restoreTried: false,
    timePicker: false,
    cal: { month: new Date(), start: null, end: null },
    summary: null,
    amount: null,
    cost: null,
    keys: [],
    filter: { preset: "thisMonth", apiKey: "all", start: null, end: null },
    metric: "cost",
    status: null,
    reqId: 0,
    usageCache: {}
  };

  function isOpen() { return card.classList.contains("dsp-open"); }

  function positionCard() {
    var r = launcher.getBoundingClientRect();
    var left, bottom;
    if (launcher.classList.contains("dsp-float-btn")) {
      left = r.left; bottom = window.innerHeight - r.top + 8;
    } else {
      left = r.right + 8; bottom = window.innerHeight - r.top + 6;
      if (left + CARD_MIN_W > window.innerWidth) left = Math.max(8, r.left - CARD_MIN_W - 8);
    }
    card.style.left = Math.round(left) + "px";
    card.style.bottom = Math.round(bottom) + "px";
    card.style.width = Math.round(Math.min(CARD_MAX_W, window.innerWidth - left - 16)) + "px";
  }

  function setOpen(open) {
    card.classList.toggle("dsp-open", open);
    launcher.classList.toggle("dsp-active", open);
    if (open) { positionCard(); start(); }
  }

  // ---- time range ---------------------------------------------------------
  function tzOffset() { return -new Date().getTimezoneOffset() * 60; }
  function dayStart(d) { return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000); }
  function rangeFor(preset) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
    var sd, ed;
    if (preset === "yesterday") { sd = addDays(today, -1); ed = addDays(today, -1); }
    else if (preset === "7d") { sd = addDays(today, -6); ed = today; }
    else if (preset === "30d") { sd = addDays(today, -29); ed = today; }
    else if (preset === "thisMonth") { sd = new Date(now.getFullYear(), now.getMonth(), 1); ed = today; }
    else if (preset === "lastMonth") { sd = new Date(now.getFullYear(), now.getMonth() - 1, 1); ed = new Date(now.getFullYear(), now.getMonth(), 0); }
    else { sd = today; ed = today; }
    return { start: dayStart(sd), end: dayStart(ed) + 86400 };
  }
  function currentRange() {
    if (state.filter.preset === "custom" && state.filter.start != null) return { start: state.filter.start, end: state.filter.end };
    return rangeFor(state.filter.preset);
  }

  // ---- data extraction ----------------------------------------------------
  function biz(j) { if (!j) return null; return (j.data && j.data.biz_data) ? j.data.biz_data : (j.data || j); }
  function keyId(ser) {
    var k = ser && ser.api_key;
    if (!k) return "";
    return k.tracking_id || k.sensitive_id || k.name || "";
  }
  function keyLabel(ser) {
    var k = ser && ser.api_key;
    if (!k) return "Sconosciuta";
    return k.name || k.tracking_id || "API key";
  }
  function dayKey(sec) {
    var d = new Date(sec * 1000);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function computeMetrics() {
    var amount = biz(state.amount) || {};
    var cost = biz(state.cost) || {};
    var filter = state.filter.apiKey;
    var keysMap = {};
    var tokens = 0, requests = 0;
    var costByDay = {}, tokenByDay = {};
    var currency = "USD";

    (amount.series || []).forEach(function (ser) {
      var id = keyId(ser);
      if (id) keysMap[id] = keyLabel(ser);
      if (filter !== "all" && id !== filter) return;
      (ser.buckets || []).forEach(function (b) {
        var u = b.usage || {};
        var t = toInt(u.PROMPT_CACHE_HIT_TOKEN) + toInt(u.PROMPT_CACHE_MISS_TOKEN) + toInt(u.RESPONSE_TOKEN);
        tokens += t; requests += toInt(u.REQUEST);
        var d = dayKey(b.time); tokenByDay[d] = (tokenByDay[d] || 0) + t;
      });
    });

    var costArr = (cost.data && cost.data.length) ? cost.data : (cost.series ? [{ currency: cost.currency, series: cost.series }] : []);
    var totalCost = 0;
    costArr.forEach(function (cur) {
      if (cur.currency) currency = cur.currency;
      (cur.series || []).forEach(function (ser) {
        var id = keyId(ser); if (id) keysMap[id] = keyLabel(ser);
        if (filter !== "all" && id !== filter) return;
        (ser.buckets || []).forEach(function (b) {
          var v = parseFloat(b.cost || 0); totalCost += v;
          var d = dayKey(b.time); costByDay[d] = (costByDay[d] || 0) + v;
        });
      });
    });

    var keys = Object.keys(keysMap).map(function (id) { return { id: id, name: keysMap[id] }; });
    return { tokens: tokens, requests: requests, cost: totalCost, currency: currency, costByDay: costByDay, tokenByDay: tokenByDay, keys: keys };
  }

  function summaryValues() {
    var s = biz(state.summary) || {};
    var wallet = (s.normal_wallets || [])[0] || {};
    var totalCost = (s.total_costs || [])[0] || {};
    return {
      balance: wallet.balance != null ? wallet.balance : null,
      currency: wallet.currency || totalCost.currency || "USD",
      totalCost: totalCost.amount != null ? totalCost.amount : null
    };
  }

  // ---- flows --------------------------------------------------------------
  function start() {
    state.view = "checking";
    render();
    dsStatus().then(function (res) {
      state.status = res || {};
      if (res && res.ok && res.valid) { state.loggedIn = true; loadUsage(); return; }
      state.loggedIn = false;
      if (!state.restoreTried) {
        state.restoreTried = true;
        dsRestore().then(function (r) {
          if (r && r.ok && r.token) loadUsage();
          else { state.view = "login"; render(); }
        }).catch(function () { state.view = "login"; render(); });
      } else {
        state.view = "login"; render();
      }
    }).catch(function () { state.loggedIn = false; state.view = "login"; render(); });
  }

  function doLogin() {
    state.usageCache = {}; state.keys = [];
    state.view = "logging"; state.error = ""; render();
    dsLogin().catch(function () {}).then(function () { start(); });
  }

  function doLogout() {
    state.loggedIn = false; state.confirmLogout = false; state.usageCache = {}; state.keys = [];
    dsLogout().then(function () { state.summary = state.amount = state.cost = null; state.view = "login"; render(); });
  }

  function resetFilters() {
    state.filter.preset = "thisMonth"; state.filter.apiKey = "all"; state.filter.start = null; state.filter.end = null;
    scheduleLoad();
  }

  function balanceValue() {
    var s = summaryValues();
    if (s.balance == null) return null;
    var n = parseFloat(s.balance);
    return isNaN(n) ? null : n;
  }

  function updateDot() {
    var dot = launcher.querySelector(".dsp-status-dot");
    if (!dot) return;
    var v = balanceValue();
    if (!state.loggedIn || v == null) { dot.style.display = "none"; return; }
    dot.style.display = "block";
    dot.style.background = v <= 0 ? "#000000" : (v > 1 ? "#22c55e" : (v > 0.5 ? "#eab308" : "#ef4444"));
  }

  function confirmModal() {
    return el("div", { class: "dsp-confirm-overlay", on: { click: function () { state.confirmLogout = false; render(); } } }, [
      el("div", { class: "dsp-confirm", on: { click: function (e) { e.stopPropagation(); } } }, [
      el("div", { class: "dsp-confirm-title", text: t("logout") }),
      el("div", { class: "dsp-confirm-msg", text: t("confirm_msg") }),
      el("div", { class: "dsp-confirm-actions" }, [
        el("button", { class: "dsp-ghost", type: "button", text: t("cancel"), on: { click: function () { state.confirmLogout = false; render(); } } }),
        el("button", { class: "dsp-ghost dsp-danger", type: "button", text: t("logout"), on: { click: function () { state.confirmLogout = false; doLogout(); } } })
        ])
      ])
    ]);
  }

  function localeId() { return LOCALE === "it" ? "it-IT" : "en-US"; }
  function monthTitle(d) { return d.toLocaleDateString(localeId(), { month: "long", year: "numeric" }); }
  function weekdayNames() {
    var fmt = new Intl.DateTimeFormat(localeId(), { weekday: "narrow" });
    var names = [];
    for (var i = 0; i < 7; i++) names.push(fmt.format(new Date(2024, 0, 7 + i)));
    return names;
  }
  function presetLabel(id) {
    for (var i = 0; i < TIME_PRESETS.length; i++) if (TIME_PRESETS[i].id === id) return TIME_PRESETS[i].label;
    return id;
  }
  function monthGrid(year, month, calStart, calEnd) {
    var firstWeekday = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var grid = el("div", { class: "dsp-cal-grid" });
    weekdayNames().forEach(function (n) { grid.appendChild(el("div", { class: "dsp-cal-wd", text: n })); });
    for (var i = 0; i < firstWeekday; i++) grid.appendChild(el("div", { class: "dsp-cal-day dsp-cal-empty" }));
    var add = function (d) {
      var sec = dayStart(new Date(year, month, d));
      var cls = "dsp-cal-day";
      if (calStart != null && calEnd != null && sec >= calStart && sec <= calEnd) cls += " dsp-cal-inrange";
      if ((calStart != null && sec === calStart) || (calEnd != null && sec === calEnd)) cls += " dsp-cal-edge";
      var cell = el("div", { class: cls, text: String(d) });
      cell.addEventListener("click", function () { pickDay(sec); });
      grid.appendChild(cell);
    };
    for (var d = 1; d <= daysInMonth; d++) add(d);
    return grid;
  }
  function pickDay(sec) {
    var c = state.cal;
    if (c.start == null || c.end != null) { c.start = sec; c.end = null; }
    else if (sec < c.start) { c.end = c.start; c.start = sec; }
    else { c.end = sec; }
    render();
  }
  function openTimePicker() {
    var r = currentRange();
    var d = new Date(r.start * 1000);
    state.cal = { month: new Date(d.getFullYear(), d.getMonth(), 1), start: null, end: null };
    if (state.filter.preset === "custom" && state.filter.start != null) {
      state.cal.start = state.filter.start;
      state.cal.end = state.filter.end != null ? state.filter.end - 86400 : null;
    }
    state.timePicker = true;
    render();
  }
  function choosePreset(id) {
    state.filter.preset = id;
    state.filter.start = null; state.filter.end = null;
    state.timePicker = false;
    if (id === "custom") { render(); return; }
    scheduleLoad();
  }
  function applyCustom() {
    var c = state.cal;
    if (c.start == null || c.end == null) return;
    state.filter.preset = "custom";
    state.filter.start = c.start;
    state.filter.end = c.end + 86400;
    state.timePicker = false;
    scheduleLoad();
  }
  function timePickerModal() {
    var c = state.cal;
    var m1 = c.month;
    var m2 = new Date(m1.getFullYear(), m1.getMonth() + 1, 1);
    var presets = el("div", { class: "dsp-cal-presets" }, TIME_PRESETS.map(function (p) {
      return el("div", { class: "dsp-cal-preset" + (state.filter.preset === p.id ? " dsp-on" : ""), text: p.label, on: { click: function () { choosePreset(p.id); } } });
    }));
    var months = el("div", { class: "dsp-cal-months" }, [
      el("div", { class: "dsp-cal" }, [el("div", { class: "dsp-cal-mtitle", text: monthTitle(m1) }), monthGrid(m1.getFullYear(), m1.getMonth(), c.start, c.end)]),
      el("div", { class: "dsp-cal" }, [el("div", { class: "dsp-cal-mtitle", text: monthTitle(m2) }), monthGrid(m2.getFullYear(), m2.getMonth(), c.start, c.end)])
    ]);
    var nav = el("div", { class: "dsp-cal-nav" }, [
      el("button", { class: "dsp-icon-btn", type: "button", html: "&#8249;", on: { click: function () { state.cal.month = new Date(m1.getFullYear(), m1.getMonth() - 1, 1); render(); } } }),
      el("div", { class: "dsp-cal-nav-title", text: monthTitle(m1) + " - " + monthTitle(m2) }),
      el("button", { class: "dsp-icon-btn", type: "button", html: "&#8250;", on: { click: function () { state.cal.month = new Date(m1.getFullYear(), m1.getMonth() + 1, 1); render(); } } })
    ]);
    var apply = el("button", { class: "dsp-ghost", type: "button", text: t("apply"), on: { click: applyCustom } });
    if (c.start == null || c.end == null) apply.setAttribute("disabled", "disabled");
    var actions = el("div", { class: "dsp-cal-actions" }, [
      el("button", { class: "dsp-ghost", type: "button", text: t("cancel"), on: { click: function () { state.timePicker = false; render(); } } }),
      apply
    ]);
    return el("div", { class: "dsp-confirm-overlay", on: { click: function () { state.timePicker = false; render(); } } }, [
      el("div", { class: "dsp-timepanel", on: { click: function (e) { e.stopPropagation(); } } }, [
        presets,
        el("div", { class: "dsp-cal-main" }, [nav, months, actions])
      ])
    ]);
  }

  function applyUsage(res) {
    if (res.summary) state.summary = res.summary;
    if (res.amount) state.amount = res.amount;
    if (res.cost) state.cost = res.cost;
    var m = computeMetrics();
    if (res.keys && res.keys.length) state.keys = mergeKeys(apiKeysFrom(res.keys), m.keys);
    else if (m.keys.length) state.keys = m.keys;
  }

  function loadUsage(force) {
    state.error = "";
    var range = currentRange();
    var tz = tzOffset();
    var whole = 3600 * Math.floor(tz / 3600), rem = tz - whole;
    var params = { start: range.start + rem, end: range.end + rem, tz: whole };
    var key = state.filter.preset + ":" + state.filter.apiKey + ":" + params.start + ":" + params.end;
    var cached = state.usageCache[key];
    if (!force && cached && Date.now() - cached.at < 30000) {
      applyUsage(cached.data);
      state.loggedIn = true;
      state.view = "dashboard";
      render();
      return;
    }
    state.loading = true;
    render();
    var myId = ++state.reqId;
    dsUsage(params).then(function (res) {
      if (myId !== state.reqId) return; // a newer request superseded this one
      state.loading = false;
      if (!res || !res.ok) {
        var err = (res && res.error) || "";
        if (err === "not_authenticated" || /40[13]/.test(err)) { state.loggedIn = false; state.view = "login"; }
        else {
          // Keep the previous data instead of blanking the panel.
          state.view = "dashboard";
          if (!state.summary) state.error = friendlyError(err);
        }
        render(); return;
      }
      state.loggedIn = true;
      applyUsage(res);
      state.usageCache[key] = { at: Date.now(), data: res };
      state.view = "dashboard";
      render();
    }).catch(function (e) {
      if (myId !== state.reqId) return;
      state.loading = false; state.view = "dashboard";
      if (!state.summary) state.error = friendlyError(e && e.message);
      render();
    });
  }

  var loadTimer = null;
  function scheduleLoad() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(function () { loadTimer = null; loadUsage(); }, 200);
  }

  // ---- dropdown -----------------------------------------------------------
  function dropdown(label, options, selected, onSelect) {
    var menu = el("div", { class: "dsp-menu" });
    var btn = el("button", { class: "dsp-drop-btn", type: "button", on: { click: function (e) { e.stopPropagation(); closeAllMenus(); menu.classList.toggle("dsp-menu-open"); } } });
    var sel = null;
    for (var i = 0; i < options.length; i++) if (options[i].id === selected) sel = options[i];
    btn.appendChild(el("span", { text: sel ? sel.label : (label || "Seleziona") }));
    btn.appendChild(el("span", { class: "dsp-caret", html: "&#9662;" }));
    options.forEach(function (opt) {
      menu.appendChild(el("div", {
        class: "dsp-menu-item",
        on: { click: function (e) { e.stopPropagation(); closeAllMenus(); onSelect(opt.id); } }
      }, [
        el("span", {}, [el("span", { text: opt.label }), opt.sub ? el("span", { class: "dsp-sub", text: "  " + opt.sub }) : null]),
        opt.id === selected ? el("span", { class: "dsp-check", html: "&#10003;" }) : null
      ]));
    });
    var wrap = el("div", { class: "dsp-drop" }, [btn, menu]);
    return wrap;
  }
  function closeAllMenus() {
    var open = card.querySelectorAll(".dsp-menu-open");
    for (var i = 0; i < open.length; i++) open[i].classList.remove("dsp-menu-open");
  }

  // ---- chart (HTML bars: crisp text, no SVG scaling) ----------------------
  function buildChart(byDay, metric) {
    var keys = Object.keys(byDay).sort();
    if (!keys.length) return el("div", { class: "dsp-empty", text: t("no_data") });
    var max = 0;
    keys.forEach(function (k) { if (byDay[k] > max) max = byDay[k]; });
    if (max <= 0) return el("div", { class: "dsp-empty", text: t("no_data") });
    var plot = el("div", { class: "dsp-plot" });
    keys.forEach(function (k) {
      var v = byDay[k];
      var tip = k + ": " + (metric === "cost" ? "$" + v.toFixed(2) : fmtInt(v));
      var fill = el("div", { class: "dsp-barfill", title: tip });
      fill.style.height = Math.max(2, (v / max) * 100) + "%";
      plot.appendChild(el("div", { class: "dsp-col" }, [fill]));
    });
    var maxLabel = el("div", { class: "dsp-maxlabel", text: metric === "cost" ? "$" + max.toFixed(2) : fmtInt(max) });
    var xrow = el("div", { class: "dsp-xrow" }, [
      el("span", { text: keys[0] }),
      keys.length > 1 ? el("span", { text: keys[keys.length - 1] }) : null
    ]);
    return el("div", {}, [maxLabel, plot, xrow]);
  }

  // ---- views --------------------------------------------------------------
  function makeIcon(extraClass, parts) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "dsp-ico " + extraClass);
    svg.setAttribute("aria-hidden", "true");
    var stroke = { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" };
    parts.forEach(function (part) {
      var node = document.createElementNS(ns, part[0]);
      var attrs = part[1];
      for (var k in attrs) node.setAttribute(k, attrs[k]);
      for (var j in stroke) node.setAttribute(j, stroke[j]);
      svg.appendChild(node);
    });
    return svg;
  }
  function svgRefresh() {
    return makeIcon("dsp-ico-refresh", [
      ["polyline", { points: "23 4 23 10 17 10" }],
      ["polyline", { points: "1 20 1 14 7 14" }],
      ["path", { d: "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" }]
    ]);
  }
  function svgExternal() {
    return makeIcon("dsp-ico-ext", [
      ["path", { d: "M7 17 17 7" }],
      ["polyline", { points: "8 7 17 7 17 16" }]
    ]);
  }

  function header() {
    var refresh = el("button", { class: "dsp-icon-btn dsp-refresh", type: "button", title: t("refresh"), "aria-label": t("refresh"), on: { click: function () { loadUsage(true); } } });
    var refreshIcon = svgRefresh();
    if (state.loading) refreshIcon.classList.add("dsp-spin");
    refresh.appendChild(refreshIcon);
    return el("div", { class: "dsp-head" }, [
      el("div", { class: "dsp-head-left" }, [
        el("div", { class: "dsp-head-brand" }, [svgMark(), el("span", { text: "DeepSeek" })]),
        refresh
      ]),
      el("button", { class: "dsp-icon-btn", type: "button", title: t("close"), "aria-label": t("close"), html: "&#10005;", on: { click: function () { setOpen(false); } } })
    ]);
  }

  function loginView() {
    return el("div", { class: "dsp-body" }, [
      el("div", { class: "dsp-login" }, [
        svgMark(),
        el("h2", { text: t("login_title") }),
        el("p", { class: "dsp-muted", text: t("login_desc") }),
        el("button", { class: "dsp-primary", type: "button", text: t("login_button"), on: { click: doLogin } }),
        state.error ? el("div", { class: "dsp-error", text: state.error }) : null,
        el("p", { class: "dsp-fine", text: t("login_fine") })
      ])
    ]);
  }

  function loggingView() {
    return el("div", { class: "dsp-body" }, [
      el("div", { class: "dsp-spinner" }),
      el("p", { class: "dsp-muted", style: "text-align:center", text: t("logging") })
    ]);
  }

  function checkingView() { return el("div", { class: "dsp-body" }, [el("div", { class: "dsp-spinner" })]); }

  function dashboardView() {
    var m = computeMetrics();
    var s = summaryValues();
    var keyOptions = [{ id: "all", label: t("all_keys") }].concat(state.keys.map(function (k) { return { id: k.id, label: k.name, sub: k.id.slice(0, 10) }; }));

    var timeBtn = el("button", { class: "dsp-drop-btn", type: "button", on: { click: openTimePicker } });
    timeBtn.appendChild(el("span", { text: presetLabel(state.filter.preset) }));
    timeBtn.appendChild(el("span", { class: "dsp-caret", html: "&#9662;" }));
    var bar = el("div", { class: "dsp-bar" }, [
      timeBtn,
      dropdown("API Key", keyOptions, state.filter.apiKey, function (id) { state.filter.apiKey = id; render(); }),
      el("button", { class: "dsp-drop-btn", type: "button", text: t("reset"), on: { click: resetFilters } }),
      s.currency ? el("span", { class: "dsp-muted", style: "margin-left:auto", text: s.currency }) : null
    ]);

    var summaryRow = el("div", { class: "dsp-row dsp-row-2", style: "margin-bottom:10px" }, [
      el("div", { class: "dsp-cardbox" }, [
        el("div", { class: "dsp-k", text: t("balance") }),
        el("div", { class: "dsp-balance-row" }, [
          el("span", { class: "dsp-big", text: s.balance != null ? fmtAmount(s.balance, s.currency) : "-" })
        ])
      ]),
      el("div", { class: "dsp-cardbox" }, [
        el("div", { class: "dsp-k", text: t("total_cost") }),
        el("div", { class: "dsp-big", text: s.totalCost != null ? fmtAmount(parseFloat(s.totalCost), s.currency) : "-" })
      ])
    ]);

    var metricsRow = el("div", { class: "dsp-row dsp-row-3", style: "margin-bottom:10px" }, [
      el("div", { class: "dsp-cardbox" }, [
        el("div", { class: "dsp-k", text: t("cost") }),
        el("div", { class: "dsp-v-sm" }, [el("span", { text: fmtAmount(m.cost, m.currency) })])
      ]),
      el("div", { class: "dsp-cardbox" }, [
        el("div", { class: "dsp-k", text: t("requests") }),
        el("div", { class: "dsp-v-sm", text: fmtInt(m.requests) })
      ]),
      el("div", { class: "dsp-cardbox" }, [
        el("div", { class: "dsp-k", text: t("tokens") }),
        el("div", { class: "dsp-v-sm", text: fmtInt(m.tokens) })
      ])
    ]);

    var chartTitle = state.metric === "cost" ? t("cost") + " (" + m.currency + ")" : t("tokens");
    var seg = el("div", { class: "dsp-seg" }, [
      el("button", { class: state.metric === "cost" ? "dsp-on" : "", type: "button", text: t("cost"), on: { click: function () { state.metric = "cost"; render(); } } }),
      el("button", { class: state.metric === "token" ? "dsp-on" : "", type: "button", text: t("tokens"), on: { click: function () { state.metric = "token"; render(); } } })
    ]);
    var chart = el("div", { class: "dsp-chart" }, [
      el("div", { class: "dsp-chart-head" }, [
        el("div", { class: "dsp-muted", text: chartTitle }),
        seg
      ]),
      buildChart(state.metric === "cost" ? m.costByDay : m.tokenByDay, state.metric)
    ]);

    var dashBtn = el("button", { class: "dsp-ghost", type: "button", on: { click: function () { if (window.api && window.api.openLink) window.api.openLink(DASHBOARD_URL); else window.open(DASHBOARD_URL, "_blank"); } } });
    dashBtn.appendChild(el("span", { text: t("dashboard") }));
    dashBtn.appendChild(svgExternal());
    var foot = el("div", { class: "dsp-foot" }, [
      dashBtn,
      el("button", { class: "dsp-ghost dsp-danger", type: "button", text: t("logout"), on: { click: function () { state.confirmLogout = true; render(); } } })
    ]);

    var content = el("div", { class: "dsp-body" }, [
      state.error ? el("div", { class: "dsp-error", style: "margin-bottom:10px", text: state.error }) : null,
      summaryRow,
      bar,
      metricsRow,
      chart,
      foot
    ]);
    return content;
  }

  function render() {
    card.textContent = "";
    card.appendChild(header());
    var scroll = el("div", { class: "dsp-scroll" });
    scroll.appendChild(
      state.view === "login" ? loginView() :
      state.view === "logging" ? loggingView() :
      state.view === "checking" ? checkingView() : dashboardView()
    );
    card.appendChild(scroll);
    if (state.confirmLogout) card.appendChild(confirmModal());
    if (state.timePicker) card.appendChild(timePickerModal());
    updateDot();
  }

  // ---- launcher mount -----------------------------------------------------
  function findRail() {
    var divs = document.querySelectorAll("div");
    var classed = null, classedH = 0, any = null, anyH = 0;
    for (var i = 0; i < divs.length; i++) {
      var r = divs[i].getBoundingClientRect();
      if (!(r.left < 10 && r.width >= 44 && r.width <= 96 && r.height > 220 && r.top < 140)) continue;
      if (r.height > anyH) { anyH = r.height; any = divs[i]; }
      var cls = "" + (divs[i].className || "");
      if (cls.indexOf("bg-background-base") >= 0 && r.height > classedH) { classedH = r.height; classed = divs[i]; }
    }
    return classed || any;
  }
  function bottomCluster(rail) {
    var marked = rail.querySelector('[class*="pb-6"]');
    if (marked) return marked;
    var kids = rail.children, fallback = null;
    for (var i = kids.length - 1; i >= 0; i--) {
      var k = kids[i];
      if (k === launcher || k.tagName !== "DIV") continue;
      if (!fallback) fallback = k;
      if (k.querySelector("button") && k.getBoundingClientRect().height < 220) return k;
    }
    for (var j = kids.length - 1; j >= 0; j--) {
      if (kids[j] !== launcher && kids[j].tagName === "DIV" && kids[j].querySelector("button")) return kids[j];
    }
    return fallback;
  }
  function inRail() {
    var p = launcher.parentNode;
    if (!p || p === document.body) return false;
    var r = p.getBoundingClientRect();
    return r.left < 12 && r.width <= 92 && r.height > 200;
  }
  function mountLauncher() {
    if (inRail()) return true;
    var rail = findRail();
    if (rail) {
      var cluster = bottomCluster(rail);
      if (cluster) { if (launcher.parentNode !== cluster || cluster.firstChild !== launcher) cluster.insertBefore(launcher, cluster.firstChild); }
      else if (launcher.parentNode !== rail || rail.lastElementChild !== launcher) rail.appendChild(launcher);
      launcher.classList.remove("dsp-float-btn");
      return true;
    }
    if (launcher.parentNode !== document.body) { launcher.classList.add("dsp-float-btn"); document.body.appendChild(launcher); }
    return false;
  }

  function boot() {
    if (document.getElementById("deepseek-panel-card")) return;
    injectStyles();
    document.body.appendChild(card);
    render();
    launcher.addEventListener("click", function () { setOpen(!isOpen()); });
    mountLauncher();
    setInterval(mountLauncher, 1500);

    card.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") setOpen(false); }, false);
    card.addEventListener("mousedown", function (e) { e.stopPropagation(); }, false);
    card.addEventListener("click", function (e) { closeAllMenus(); }, false);
    document.addEventListener("mousedown", function (e) {
      if (isOpen() && !card.contains(e.target) && !launcher.contains(e.target)) setOpen(false);
    }, true);
    window.addEventListener("resize", function () { if (isOpen()) positionCard(); });
  }

  window.__deepseekPanel = { open: function () { setOpen(true); }, close: function () { setOpen(false); }, reload: loadUsage, render: render, state: state };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
