// Static server for the checks: serves site/ the way Cloudflare Pages does (directory index,
// headers from site/_headers), so a Content Security Policy violation shows up in the browser
// exactly as it would on the published page.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function readHeaderRules(root) {
  const file = path.join(root, "_headers");
  if (!fs.existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
    } else if (current && raw.trim().startsWith("!")) {
      // "! Name" detaches a header an earlier rule set, as on Cloudflare Pages.
      current.headers.push([raw.trim().slice(1).trim(), null]);
    } else if (current) {
      const at = raw.indexOf(":");
      current.headers.push([raw.slice(0, at).trim(), raw.slice(at + 1).trim()]);
    }
  }
  return rules;
}

function matches(pattern, urlPath) {
  if (pattern.endsWith("*")) return urlPath.startsWith(pattern.slice(0, -1));
  return pattern === urlPath;
}

// Hands a request under /api/ to a (Request) => Promise<Response> handler, the way a Pages Function
// receives it, and writes its answer back.
async function answerApi(api, req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, { method: req.method, headers: req.headers, body: hasBody ? req : undefined, duplex: "half" });
  const response = await api(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function start(root, options = {}) {
  const rules = readHeaderRules(root);
  const server = http.createServer((req, res) => {
    if (options.api && req.url.startsWith("/api/")) {
      answerApi(options.api, req, res).catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain" }).end(String(error));
      });
      return;
    }
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.join(root, urlPath);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" };
    for (const rule of rules) {
      if (!matches(rule.pattern, urlPath)) continue;
      for (const [k, v] of rule.headers) {
        if (v === null) delete headers[k];
        else headers[k] = v;
      }
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { start };
