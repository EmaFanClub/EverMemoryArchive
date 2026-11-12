#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const uiRoot = path.join(pkgRoot, "ui");
const port = Number(process.env.PORT || 18765);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const WORKBENCH_FALLBACK_CSS = `
:root {
  --wb-bg: #0f172a;
  --wb-surface: #1e293b;
  --wb-hover: #334155;
  --wb-border: #334155;
  --wb-fg: #f8fafc;
  --wb-muted: #94a3b8;
  --wb-accent: #38bdf8;
  --wb-accent-fg: #0f172a;
  --wb-radius: 8px;
  --wb-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --wb-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
body {
  background: var(--wb-bg);
  color: var(--wb-fg);
  margin: 0;
}
`;

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(302, { Location: "/ui/index.html" });
      res.end();
      return;
    }

    if (pathname === "/workbench-ui.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(WORKBENCH_FALLBACK_CSS);
      return;
    }

    if (pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body = undefined;
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }
      const query = {};
      for (const [k, v] of parsedUrl.searchParams.entries()) {
        query[k] = v;
      }

      const mod = await import(`${path.join(pkgRoot, "dist/module.js")}?v=${Date.now()}`);
      const wbRes = await mod.handleWorkbenchRequest({
        method: req.method || "GET",
        path: pathname,
        query,
        body,
      });

      res.writeHead(wbRes.status || 200, {
        "Content-Type": "application/json; charset=utf-8",
        ...(wbRes.headers || {}),
      });
      res.end(JSON.stringify(wbRes.body ?? {}));
      return;
    }

    const relPath = pathname.startsWith("/ui/")
      ? pathname.slice("/ui/".length)
      : pathname.slice(1);
    const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = path.join(uiRoot, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Sakana-kawaii Live Chat WebUI listening on http://localhost:${port}/ui/index.html`);
});
