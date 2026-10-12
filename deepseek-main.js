/*
 * DeepSeek bridge for the OpenCode desktop main process.
 *
 * Added to resources/app.asar as out/main/deepseek-main.js and set as the app
 * entry by apply.js. It imports the original main (out/main/index.js) and then
 * registers a few IPC handlers:
 *
 *   deepseek-status  -> { ok, valid }   token present + still valid
 *   deepseek-login   -> { ok, token }   opens a DeepSeek sign-in window and
 *                                       captures the session Bearer token
 *                                       automatically from its requests
 *   deepseek-logout  -> { ok }          clears the stored token
 *   deepseek-usage   -> { ok, summary, amount, cost }
 *
 * The login window uses a persistent partition, so the DeepSeek session cookie
 * survives across launches (usually no re-login). A custom email/password POST
 * cannot work because the login endpoint is behind an AWS WAF challenge - only
 * a real browser window can sign in. Usage lives on platform.deepseek.com (no
 * CORS for oc://renderer), so it is fetched here and handed over via IPC.
 */
import { app, BrowserWindow, ipcMain, session, net } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "./index.js";

const BASE = "https://platform.deepseek.com";
const PARTITION = "persist:deepseek-platform";
const COMMON_HEADERS = { "x-app-version": "20240425.0", accept: "*/*", referer: BASE + "/usage" };

let token = null;
let pendingLogin = null;
let captureAttached = false;
let capturing = false;
let summaryCache = { value: null, at: 0 };
let keysCache = { value: null, at: 0 };
const SUMMARY_TTL = 60 * 1000;
const KEYS_TTL = 5 * 60 * 1000;
function clearCaches() { summaryCache = { value: null, at: 0 }; keysCache = { value: null, at: 0 }; }

function tokenFile() { return join(app.getPath("userData"), "deepseek-session.json"); }
function loadToken() {
  if (token) return token;
  try {
    const parsed = JSON.parse(readFileSync(tokenFile(), "utf8"));
    if (parsed && typeof parsed.token === "string") token = parsed.token;
  } catch (e) { /* no stored token */ }
  return token;
}
function saveToken(value) {
  token = value;
  try { writeFileSync(tokenFile(), JSON.stringify({ token: value, at: Date.now() })); } catch (e) { /* ignore */ }
}
function clearToken() {
  token = null;
  try { writeFileSync(tokenFile(), "{}"); } catch (e) { /* ignore */ }
}

function dsSession() { return session.fromPartition(PARTITION); }

function cookieFile() { return join(app.getPath("userData"), "deepseek-cookies.json"); }
function cookieUrl(domain, cookiePath, secure) {
  return (secure ? "https" : "http") + "://" + String(domain || "platform.deepseek.com").replace(/^\./, "") + (cookiePath || "/");
}

async function readCookies() {
  try { return await dsSession().cookies.get({ url: BASE + "/" }); } catch (e) { return []; }
}

// Electron drops session cookies (those without an expirationDate) on quit,
// unlike a browser with "restore session" enabled. Promote them to persistent
// cookies so the DeepSeek login survives restarts.
async function persistCookies() {
  const ses = dsSession();
  const far = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60;
  try {
    const cookies = await ses.cookies.get({ url: BASE + "/" });
    for (const c of cookies) {
      if (!c.session) continue;
      const details = {
        url: cookieUrl(c.domain, c.path, c.secure),
        name: c.name, value: c.value, path: c.path,
        httpOnly: c.httpOnly, secure: c.secure, expirationDate: far
      };
      if (c.domain) details.domain = c.domain;
      if (c.sameSite) details.sameSite = c.sameSite;
      try { await ses.cookies.set(details); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  try { await ses.cookies.flushStore(); } catch (e) { /* ignore */ }
}

async function saveCookieBackup() {
  try {
    const cookies = await readCookies();
    const data = cookies.map(function (c) {
      return { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate };
    });
    writeFileSync(cookieFile(), JSON.stringify({ at: Date.now(), cookies: data }));
  } catch (e) { /* ignore */ }
}

async function restoreCookieBackup() {
  let data = null;
  try { data = JSON.parse(readFileSync(cookieFile(), "utf8")); } catch (e) { return; }
  if (!data || !data.cookies || !data.cookies.length) return;
  const ses = dsSession();
  const far = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60;
  for (const c of data.cookies) {
    const details = {
      url: cookieUrl(c.domain, c.path, c.secure),
      name: c.name, value: c.value, path: c.path,
      httpOnly: c.httpOnly, secure: c.secure, expirationDate: c.expirationDate || far
    };
    if (c.domain) details.domain = c.domain;
    if (c.sameSite) details.sameSite = c.sameSite;
    try { await ses.cookies.set(details); } catch (e) { /* ignore */ }
  }
  try { await ses.cookies.flushStore(); } catch (e) { /* ignore */ }
}

// If the cookie store lost the session (e.g. not flushed), re-inject the backup.
async function ensureCookies() {
  const existing = await readCookies();
  if (!existing || !existing.length) await restoreCookieBackup();
}

async function validate(value) {
  try {
    const res = await net.fetch(BASE + "/api/v0/users/get_user_summary", {
      headers: Object.assign({}, COMMON_HEADERS, { authorization: "Bearer " + value })
    });
    if (!res.ok) return { ok: false, error: "HTTP " + res.status };
    const json = await res.json();
    return json && json.code === 0 ? { ok: true } : { ok: false, error: (json && json.msg) || ("code " + (json && json.code)) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function attachCapture() {
  if (captureAttached) return;
  captureAttached = true;
  dsSession().webRequest.onBeforeSendHeaders({ urls: [BASE + "/*"] }, (details, callback) => {
    const headers = details.requestHeaders || {};
    const auth = headers.Authorization || headers.authorization;
    if (auth && /^Bearer\s+/i.test(auth) && pendingLogin && !capturing) {
      const value = auth.replace(/^Bearer\s+/i, "").trim();
      if (value && value !== token) {
        capturing = true;
        validate(value).then((check) => {
          capturing = false;
          if (check.ok && pendingLogin) pendingLogin(value);
        }).catch(() => { capturing = false; });
      }
    }
    callback({ requestHeaders: headers });
  });
}

async function runLoginWindow(silent) {
  attachCapture();
  loadToken();
  await ensureCookies();
  if (token && (await validate(token)).ok) return { ok: true, token };

  return await new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      show: false,
      title: "DeepSeek",
      autoHideMenuBar: true,
      backgroundColor: "#131010",
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    let settled = false;
    let poll = null;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      pendingLogin = null;
      if (poll) clearInterval(poll);
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const succeed = (value) => {
      saveToken(value);
      clearCaches();
      persistCookies().then(saveCookieBackup);
      finish({ ok: true, token: value });
      if (!win.isDestroyed()) {
        win.close();
        setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 400);
      }
    };
    pendingLogin = succeed;
    win.on("closed", () => finish({ ok: !!loadToken(), token: loadToken() || null }));
    // Only a main-frame failure counts; subresource errors (and ERR_ABORTED, -3)
    // must be ignored, otherwise the flow would end before the token is caught.
    win.webContents.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish({ ok: !!loadToken(), token: loadToken() || null });
    });
    win.loadURL(BASE + "/sign_in").catch(() => finish({ ok: false, token: null }));

    // The platform persists the session token in localStorage["userToken"]
    // (JSON: {"value":"<token>"}). Reading it is more reliable than sniffing
    // request headers, especially when the window opens already signed in.
    poll = setInterval(() => {
      if (settled || win.isDestroyed()) { if (poll) clearInterval(poll); return; }
      win.webContents.executeJavaScript('localStorage.getItem("userToken")').then((raw) => {
        if (!raw) return;
        let value = raw;
        try { const parsed = JSON.parse(raw); if (parsed && typeof parsed.value === "string") value = parsed.value; } catch (e) { /* plain string */ }
        if (settled || typeof value !== "string" || value.length < 20 || value === token) return;
        validate(value).then((check) => { if (check.ok && !settled) succeed(value); });
      }).catch(() => {});
    }, 1200);

    if (silent) {
      // Try to reuse a persisted session without showing anything.
      timer = setTimeout(() => { if (!settled) { if (!win.isDestroyed()) win.close(); finish({ ok: false, token: null }); } }, 4500);
    } else {
      // Only reveal the window if the session could not be restored automatically.
      timer = setTimeout(() => { if (!settled && !win.isDestroyed()) win.show(); }, 1200);
    }
  });
}

function bizData(json) {
  if (!json) return null;
  if (json.data && json.data.biz_data) return json.data.biz_data;
  return json.data || json;
}

async function dsGet(path) {
  const current = loadToken();
  if (!current) throw new Error("not_authenticated");
  const res = await net.fetch(BASE + path, { headers: Object.assign({}, COMMON_HEADERS, { authorization: "Bearer " + current }) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

async function dsGetKeys() {
  try {
    const data = bizData(await dsGet("/api/v0/users/get_api_keys"));
    return (data && data.api_keys) || [];
  } catch (e) { return []; }
}

ipcMain.handle("deepseek-status", async () => {
  loadToken();
  if (!token) return { ok: false, valid: false };
  const check = await validate(token);
  return check.ok ? { ok: true, valid: true } : { ok: false, valid: false };
});

ipcMain.handle("deepseek-login", async () => runLoginWindow(false));
ipcMain.handle("deepseek-restore", async () => runLoginWindow(true));

ipcMain.handle("deepseek-logout", async () => {
  clearToken();
  clearCaches();
  try { writeFileSync(cookieFile(), "{}"); } catch (e) { /* ignore */ }
  try { await dsSession().clearStorageData(); } catch (e) { /* ignore */ }
  try { await dsSession().clearCache(); } catch (e) { /* ignore */ }
  return { ok: true };
});

function usageReady(summary) {
  const data = bizData(summary);
  return !!(data && (data.normal_wallets || []).length);
}

async function waitSummary(deadline) {
  let summary = null;
  for (;;) {
    try { summary = await dsGet("/api/v0/users/get_user_summary"); } catch (e) { summary = null; }
    if (usageReady(summary)) return summary;
    if (Date.now() >= deadline) return summary;
    await new Promise((r) => setTimeout(r, 1200));
  }
}

// Summary and the API key list do not depend on the selected period, so cache
// them. This keeps filtering responsive and avoids hammering the platform API.
async function getSummary() {
  if (summaryCache.value && Date.now() - summaryCache.at < SUMMARY_TTL) return summaryCache.value;
  const summary = await waitSummary(Date.now() + 12000);
  if (usageReady(summary)) { summaryCache.value = summary; summaryCache.at = Date.now(); }
  return summary;
}

async function getKeys() {
  if (keysCache.value && Date.now() - keysCache.at < KEYS_TTL) return keysCache.value;
  const keys = await dsGetKeys();
  if (keys && keys.length) { keysCache.value = keys; keysCache.at = Date.now(); }
  return keys;
}

ipcMain.handle("deepseek-usage", async (_event, params) => {
  const p = params || {};
  if (p.start == null || p.end == null || p.tz == null) return { ok: false, error: "bad_params" };
  const query = "?start=" + encodeURIComponent(p.start) + "&end=" + encodeURIComponent(p.end) + "&tz=" + encodeURIComponent(p.tz);
  try {
    // Right after login the API can answer with empty payloads for a moment;
    // the summary is retried until it is populated, then cached.
    const summary = await getSummary();
    const amount = await dsGet("/api/v0/usage/by_api_key/amount" + query).catch(() => null);
    const cost = await dsGet("/api/v0/usage/by_api_key/cost" + query).catch(() => null);
    const keys = await getKeys();
    return { ok: true, summary, amount, cost, keys };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// Make sure the (promoted) session cookies are written to disk before exit.
app.on("will-quit", () => {
  persistCookies().then(saveCookieBackup).catch(() => {});
});
