#!/usr/bin/env node
/*
 * apply.js - install / remove the DeepSeek dashboard into the OpenCode desktop app.
 *
 * Since v2 this addon shares a single append-only main entry, out/main/oc-addons.js,
 * with the other addons (see whatsNew.md). install appends:
 *   + out/main/deepseek-main.js      (login window + usage proxy)
 *   + out/renderer/deepseek-panel.js (the panel UI)
 *   + out/main/oc-addons.js          (shared loader, only if absent)
 *   ~ package.json                   (main -> ./out/main/oc-addons.js)
 *   ~ out/preload/index.js           (expose window.api.deepseek*)
 *   ~ out/renderer/index.html        (<script src="./deepseek-panel.js">)
 *
 * Existing data is never moved (only appended), so original offsets stay valid.
 * remove neutralizes this addon (its module becomes an empty stub) and strips
 * its renderer script tag / preload lines, without touching other addons.
 * restore-all copies the shared pristine backup back over app.asar.
 * Run while OpenCode is closed.
 *
 *   node apply.js install|remove|restore-all|status|verify [--app <dir>] [--force]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const LEGACY_BACKUP_SUFFIX = ".deepseek-backup";
const SHARED_BACKUP_SUFFIX = ".ocaddons-backup";
const BLOCK_SIZE = 4194304;
const MARKER = "deepseek-panel.js";
const SCRIPT_TAG = '<script src="./deepseek-panel.js" defer></script>';
const REMOVED_SENTINEL = "/* oc-addon-removed: deepseek */";

const MAIN_PARTS = ["out", "main", "deepseek-main.js"];
const PANEL_PARTS = ["out", "renderer", "deepseek-panel.js"];
const PRELOAD_PARTS = ["out", "preload", "index.js"];
const PRELOAD_PARTS_CJS = ["out", "preload", "index.cjs"];
const INDEX_PARTS = ["out", "renderer", "index.html"];
const PKG_PARTS = ["package.json"];
const LOADER_PARTS = ["out", "main", "oc-addons.js"];
const LOADER_MAIN = "./out/main/oc-addons.js";
const BASE_MAIN = "./out/main/index.js";

// Shared loader entry. Keep byte-identical in every addon's apply.js: whichever
// addon installs first creates it, the others reuse it as-is.
const LOADER_SRC =
  "/* oc-addons loader - shared entry for OpenCode desktop addons.\n" +
  " * Loads the base app, then any present addon main module. Addons are\n" +
  " * append-only; a removed addon is neutralized to a no-op stub. */\n" +
  'import "./index.js";\n' +
  'for (const f of ["./deepseek-main.js", "./freelancer-main.js", "./skills-main.js", "./capri-main.js"]) {\n' +
  "  try { await import(f); } catch (e) { /* addon not installed */ }\n" +
  "}\n";

function parseArgs(argv) {
  const args = { cmd: "install", app: null, force: false };
  const rest = argv.slice(2);
  if (rest[0] && !rest[0].startsWith("-")) args.cmd = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--app") args.app = rest[++i];
    else if (rest[i] === "--force") args.force = true;
  }
  return args;
}

function defaultAppDir() {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
    return path.join(base, "Programs", "@opencode-aidesktop");
  }
  if (process.platform === "darwin") return "/Applications/OpenCode.app";
  return "/opt/OpenCode";
}

function resolveAsar(appDir) {
  let base = appDir;
  if (process.platform === "darwin" && fs.existsSync(path.join(appDir, "Contents", "Resources"))) {
    base = path.join(appDir, "Contents", "Resources");
  }
  return path.join(base, "resources", "app.asar");
}

function appRunning() {
  if (process.platform !== "win32") return false;
  try {
    return /OpenCode\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq OpenCode.exe" /NH', { encoding: "utf8" }));
  } catch (e) { return false; }
}

function integrityOf(buf) {
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(crypto.createHash("sha256").update(buf.subarray(i, i + BLOCK_SIZE)).digest("hex"));
  }
  if (blocks.length === 0) blocks.push(hash);
  return { algorithm: "SHA256", hash, blockSize: BLOCK_SIZE, blocks };
}

function readHeader(asar) {
  const fd = fs.openSync(asar, "r");
  try {
    const sb = Buffer.alloc(8);
    fs.readSync(fd, sb, 0, 8, 0);
    const size = sb.readUInt32LE(4);
    if (size <= 0 || size > fs.fstatSync(fd).size - 8) throw new Error("invalid app.asar header");
    const hb = Buffer.alloc(size);
    fs.readSync(fd, hb, 0, size, 8);
    const strLen = hb.readUInt32LE(4);
    return { size, json: JSON.parse(hb.subarray(8, 8 + strLen).toString("utf8")), dataStart: 8 + size };
  } finally {
    fs.closeSync(fd);
  }
}

function nodeAt(json, parts) {
  let n = json;
  for (const p of parts) { if (!n || !n.files || !n.files[p]) return null; n = n.files[p]; }
  return n;
}
function setEntry(json, parts, entry) {
  const parent = nodeAt(json, parts.slice(0, -1));
  if (!parent || !parent.files) throw new Error("asar path not found: " + parts.join("/"));
  parent.files[parts[parts.length - 1]] = entry;
}
// The desktop app renamed the preload entry (index.js -> index.cjs): patch whichever is there.
function preloadParts(json) {
  return nodeAt(json, PRELOAD_PARTS_CJS) ? PRELOAD_PARTS_CJS : PRELOAD_PARTS;
}
function readEntry(asar, json, dataStart, parts) {
  const node = nodeAt(json, parts);
  if (!node || node.files) return null;
  const fd = fs.openSync(asar, "r");
  try {
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, dataStart + parseInt(node.offset));
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function pickleUInt32(value) {
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(value, 0);
  const out = Buffer.alloc(8);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}
function pickleString(str) {
  const bytes = Buffer.from(str, "utf8");
  const pad = (4 - (bytes.length % 4)) % 4;
  const payload = Buffer.alloc(4 + bytes.length + pad);
  payload.writeUInt32LE(bytes.length, 0);
  bytes.copy(payload, 4);
  const out = Buffer.alloc(4 + payload.length);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

function extractLogoPath(json, asar, dataStart) {
  const assets = nodeAt(json, ["out", "renderer", "assets"]);
  if (!assets || !assets.files) return null;
  const sprites = Object.keys(assets.files).filter((n) => /^sprite-.*\.svg$/.test(n));
  for (const sprite of sprites) {
    try {
      const svg = readEntry(asar, json, dataStart, ["out", "renderer", "assets", sprite]).toString("utf8");
      const i = svg.indexOf('id="deepseek"');
      if (i < 0) continue;
      const seg = svg.slice(i, svg.indexOf("</symbol>", i));
      const m = seg.match(/\sd="([^"]+)"/);
      if (m) return m[1];
    } catch (e) { /* next */ }
  }
  return null;
}

function stripIndex(html) {
  return html.replace(/<script[^>]*src=["']\.\/deepseek-panel\.js["'][^>]*><\/script>/g, "");
}
function patchIndexHtml(html) {
  let out = stripIndex(html);
  if (out.includes("</body>")) out = out.replace("</body>", SCRIPT_TAG + "</body>");
  else out += SCRIPT_TAG;
  return out;
}

function patchPreload(src, add) {
  // Drop any previously injected deepseek line so the patch stays idempotent.
  src = src.split("\n").filter((line) => !/deepseek(SetToken|Login|Restore|Logout|Status|Usage)\s*:/.test(line)).join("\n");
  if (!add) return src;
  // The app's own preload no longer exposes a window.api object to extend, so expose
  // the bridge under its own key; the panel reads window.deepseekApi first, window.api after.
  const inject =
    ';{const e=require("electron");e.contextBridge.exposeInMainWorld("deepseekApi",{' +
    'deepseekLogin:()=>e.ipcRenderer.invoke("deepseek-login"),' +
    'deepseekRestore:()=>e.ipcRenderer.invoke("deepseek-restore"),' +
    'deepseekLogout:()=>e.ipcRenderer.invoke("deepseek-logout"),' +
    'deepseekStatus:()=>e.ipcRenderer.invoke("deepseek-status"),' +
    'deepseekUsage:(p)=>e.ipcRenderer.invoke("deepseek-usage",p)});}';
  return (src.endsWith("\n") ? src : src + "\n") + inject + "\n";
}

// Panel version shown in the UI: the content of the VERSION file (single source
// of truth, works also from a downloaded zip), with a git tag fallback.
function panelVersion() {
  try {
    const v = fs.readFileSync(path.join(__dirname, "VERSION"), "utf8").trim();
    if (v) return v;
  } catch (e) { /* no VERSION file */ }
  try {
    const t = execSync("git describe --tags --abbrev=0", { cwd: __dirname, encoding: "utf8" }).trim();
    if (t) return t;
  } catch (e) { /* not a git checkout */ }
  return "dev";
}

function sharedBackup(asar) { return asar + SHARED_BACKUP_SUFFIX; }
function legacyBackup(asar) { return asar + LEGACY_BACKUP_SUFFIX; }

function pkgMainOf(asar) {
  try {
    const header = readHeader(asar);
    const raw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
    return raw ? JSON.parse(raw.toString("utf8")).main : null;
  } catch (e) { return null; }
}

// Ensure a pristine copy of app.asar exists for restore-all. Prefers the
// legacy DeepSeek backup (pristine) when present, otherwise snapshots the
// current asar only if it is still unpatched.
function ensureSharedBackup(asar) {
  const shared = sharedBackup(asar);
  if (fs.existsSync(shared)) return shared;
  const legacy = legacyBackup(asar);
  if (fs.existsSync(legacy) && pkgMainOf(legacy) === BASE_MAIN) {
    fs.copyFileSync(legacy, shared);
    console.log("Shared backup created from " + legacy);
    return shared;
  }
  if (pkgMainOf(asar) === BASE_MAIN) {
    fs.copyFileSync(asar, shared);
    console.log("Shared backup created from app.asar (pristine)");
    return shared;
  }
  console.warn("No pristine backup found: 'restore-all' will not be possible until one exists.");
  return null;
}

function install(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  if (!fs.existsSync(asar)) { console.error("app.asar not found: " + asar); process.exit(1); }
  if (appRunning() && !args.force) {
    console.error("OpenCode is running. Close it before applying the patch (or use --force).");
    process.exit(1);
  }

  const mainSrc = path.join(__dirname, "deepseek-main.js");
  const panelSrc = path.join(__dirname, "deepseek-panel.js");
  if (!fs.existsSync(mainSrc) || !fs.existsSync(panelSrc)) {
    console.error("deepseek-main.js / deepseek-panel.js not found next to apply.js");
    process.exit(1);
  }
  ensureSharedBackup(asar);

  const header = readHeader(asar);
  const pkgRaw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
  const preloadAt = preloadParts(header.json);
  const preloadRaw = readEntry(asar, header.json, header.dataStart, preloadAt);
  const indexRaw = readEntry(asar, header.json, header.dataStart, INDEX_PARTS);
  if (!pkgRaw || !preloadRaw || !indexRaw) { console.error("expected files not found in the asar"); process.exit(1); }

  const logo = extractLogoPath(header.json, asar, header.dataStart);
  if (!logo) console.warn("DeepSeek logo not extracted: the panel will use a minimal icon.");
  const mainBuf = fs.readFileSync(mainSrc);
  const panelBuf = Buffer.from(
    fs.readFileSync(panelSrc, "utf8")
      .replace("__DEEPSEEK_LOGO_PATH__", logo || "")
      .replace("__PANEL_VERSION__", panelVersion()),
    "utf8"
  );
  const preloadBuf = Buffer.from(patchPreload(preloadRaw.toString("utf8"), true), "utf8");
  const indexBuf = Buffer.from(patchIndexHtml(indexRaw.toString("utf8")), "utf8");
  const pkg = JSON.parse(pkgRaw.toString("utf8"));
  pkg.main = LOADER_MAIN;
  const pkgBuf = Buffer.from(JSON.stringify(pkg, null, 2) + "\n", "utf8");

  const needLoader = !nodeAt(header.json, LOADER_PARTS);
  const full = fs.readFileSync(asar);
  const dataBuf = full.subarray(header.dataStart);
  let cursor = dataBuf.length;
  const appended = [];
  const add = (parts, buf) => {
    setEntry(header.json, parts, { size: buf.length, offset: String(cursor), integrity: integrityOf(buf) });
    cursor += buf.length;
    appended.push(buf);
  };
  add(MAIN_PARTS, mainBuf);
  add(PANEL_PARTS, panelBuf);
  if (needLoader) add(LOADER_PARTS, Buffer.from(LOADER_SRC, "utf8"));
  add(preloadAt, preloadBuf);
  add(INDEX_PARTS, indexBuf);
  add(PKG_PARTS, pkgBuf);

  const newData = Buffer.concat([dataBuf].concat(appended));
  const headerBytes = pickleString(JSON.stringify(header.json));
  const output = Buffer.concat([pickleUInt32(headerBytes.length), headerBytes, newData]);

  const tmp = asar + ".deepseek-new";
  fs.writeFileSync(tmp, output);
  const check = readHeader(tmp);
  if (!nodeAt(check.json, MAIN_PARTS) || !nodeAt(check.json, PANEL_PARTS) || !nodeAt(check.json, LOADER_PARTS)) {
    throw new Error("validation of the new app.asar failed");
  }
  fs.renameSync(tmp, asar);

  console.log("Patch applicata: " + asar);
  console.log("Restart OpenCode. The DeepSeek button is in the prompt bar, after model/effort.");
  console.log("To remove it: node apply.js remove (DeepSeek only) or restore-all (all addons).");
}

function remove(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  if (!fs.existsSync(asar)) { console.error("app.asar not found: " + asar); process.exit(1); }
  if (appRunning() && !args.force) {
    console.error("OpenCode is running. Close it before removing (or use --force).");
    process.exit(1);
  }
  const header = readHeader(asar);
  const pkgRaw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
  const preloadAt = preloadParts(header.json);
  const preloadRaw = readEntry(asar, header.json, header.dataStart, preloadAt);
  const indexRaw = readEntry(asar, header.json, header.dataStart, INDEX_PARTS);
  if (!pkgRaw || !preloadRaw || !indexRaw) { console.error("expected files not found in the asar"); process.exit(1); }

  const hasLoader = !!nodeAt(header.json, LOADER_PARTS);
  const pkg = JSON.parse(pkgRaw.toString("utf8"));
  // Keep the shared loader as entry when present so other addons keep working.
  pkg.main = hasLoader ? LOADER_MAIN : BASE_MAIN;
  const pkgBuf = Buffer.from(JSON.stringify(pkg, null, 2) + "\n", "utf8");
  const stubBuf = Buffer.from(REMOVED_SENTINEL + "\n", "utf8");
  const preloadBuf = Buffer.from(patchPreload(preloadRaw.toString("utf8"), false), "utf8");
  const indexBuf = Buffer.from(stripIndex(indexRaw.toString("utf8")), "utf8");

  const full = fs.readFileSync(asar);
  const dataBuf = full.subarray(header.dataStart);
  let cursor = dataBuf.length;
  const appended = [];
  const add = (parts, buf) => {
    setEntry(header.json, parts, { size: buf.length, offset: String(cursor), integrity: integrityOf(buf) });
    cursor += buf.length;
    appended.push(buf);
  };
  add(MAIN_PARTS, stubBuf);
  add(preloadAt, preloadBuf);
  add(INDEX_PARTS, indexBuf);
  add(PKG_PARTS, pkgBuf);

  const newData = Buffer.concat([dataBuf].concat(appended));
  const headerBytes = pickleString(JSON.stringify(header.json));
  const output = Buffer.concat([pickleUInt32(headerBytes.length), headerBytes, newData]);
  const tmp = asar + ".deepseek-new";
  fs.writeFileSync(tmp, output);
  readHeader(tmp);
  fs.renameSync(tmp, asar);
  console.log("DeepSeek removed (module neutralized, entry preserved).");
  console.log("Restart OpenCode.");
}

function restoreAll(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const shared = sharedBackup(asar);
  const legacy = legacyBackup(asar);
  const src = fs.existsSync(shared) ? shared : (fs.existsSync(legacy) ? legacy : null);
  if (!src) { console.error("No backup found (" + shared + ")."); process.exit(1); }
  if (appRunning() && !args.force) {
    console.error("OpenCode is running. Close it before restoring (or use --force).");
    process.exit(1);
  }
  const tmp = asar + ".deepseek-restore";
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, asar);
  console.log("original app.asar restored from: " + src);
  console.log("All addons (DeepSeek and Freelancer) have been removed.");
}

function status(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const shared = sharedBackup(asar);
  const legacy = legacyBackup(asar);
  console.log("Install dir  : " + appDir);
  console.log("app.asar     : " + (fs.existsSync(asar) ? "ok" : "MANCANTE"));
  console.log("backup shared: " + (fs.existsSync(shared) ? shared : "absent"));
  if (fs.existsSync(asar)) {
    const header = readHeader(asar);
    const pkg = JSON.parse(readEntry(asar, header.json, header.dataStart, PKG_PARTS).toString("utf8"));
    const mainNode = nodeAt(header.json, MAIN_PARTS);
    const neutral = mainNode ? readEntry(asar, header.json, header.dataStart, MAIN_PARTS).toString("utf8").includes("oc-addon-removed") : false;
    console.log("main         : " + pkg.main);
    console.log("loader       : " + (nodeAt(header.json, LOADER_PARTS) ? "presente" : "absent"));
    console.log("deepseek     : " + (neutral ? "removed (stub)" : (mainNode ? "installed" : "absent")));
  }
  console.log("in esecuzione: " + (appRunning() ? "si" : "no"));
}

function verify(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const header = readHeader(asar);
  const pkg = JSON.parse(readEntry(asar, header.json, header.dataStart, PKG_PARTS).toString("utf8"));
  const preload = readEntry(asar, header.json, header.dataStart, preloadParts(header.json)).toString("utf8");
  const index = readEntry(asar, header.json, header.dataStart, INDEX_PARTS).toString("utf8");
  const main = readEntry(asar, header.json, header.dataStart, MAIN_PARTS);
  const panel = readEntry(asar, header.json, header.dataStart, PANEL_PARTS);
  if (pkg.main !== LOADER_MAIN) throw new Error("package.json main is not the shared loader");
  if (!nodeAt(header.json, LOADER_PARTS)) throw new Error("oc-addons.js (loader) mancante");
  if (!preload.includes("deepseekLogin")) throw new Error("preload: bridge deepseek mancante");
  if (!index.includes(MARKER)) throw new Error("index.html: script tag mancante");
  if (!main || !main.toString("utf8").includes("deepseek-login")) throw new Error("deepseek-main.js missing/invalid");
  if (!panel || !panel.toString("utf8").includes("__deepseekPanelLoaded")) throw new Error("deepseek-panel.js missing/invalid");
  console.log("verify ok: loader + entry + preload + index + panel (" + panel.length + " byte) + main (" + main.length + " byte)");
}

const args = parseArgs(process.argv);
try {
  if (args.cmd === "install") install(args);
  else if (args.cmd === "remove") remove(args);
  else if (args.cmd === "restore" || args.cmd === "restore-all") restoreAll(args);
  else if (args.cmd === "status") status(args);
  else if (args.cmd === "verify") verify(args);
  else { console.error("Comando sconosciuto: " + args.cmd); process.exit(1); }
} catch (err) {
  console.error("Error: " + (err && err.message ? err.message : err));
  process.exit(1);
}
