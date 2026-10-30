// Service worker of the Cockpit: keeps the app shell offline and turns push messages into
// notifications on the lock screen. A tap opens the app or the page the message points to; a tap
// on one of its buttons carries out the action through cockpit.run_action and shows the outcome.
/// <reference lib="webworker" />
import { notificationFor, parsePush, performAction, readData, resultNotification, type NotificationData, type ServerConfig } from "./notification";

interface PrecacheEntry {
  url: string;
  revision: string | null;
}

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

const MANIFEST = self.__WB_MANIFEST.map((entry) => (typeof entry === "string" ? { url: entry, revision: null } : entry));
const VERSION = MANIFEST.map((entry) => `${entry.url}@${entry.revision ?? ""}`).join("|");
const CACHE = `cockpit-${String(VERSION.length)}-${VERSION.split("").reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(36)}`;
const SHELL = "/index.html";
const SERVER: ServerConfig = { url: import.meta.env.VITE_SUPABASE_URL ?? "", anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "" };

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(MANIFEST.map((entry) => new URL(entry.url, self.location.origin).href));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(SHELL)) ?? Response.error()));
    return;
  }
  event.respondWith((async () => (await caches.match(request)) ?? fetch(request))());
});

self.addEventListener("push", (event) => {
  let raw: unknown;
  try {
    raw = event.data?.json();
  } catch {
    raw = undefined;
  }
  const { title, options } = notificationFor(parsePush(raw, event.data?.text() ?? ""));
  event.waitUntil(self.registration.showNotification(title, options));
});

async function openLink(link: string): Promise<void> {
  const target = new URL(link, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const same = windows.find((client) => client.url === target);
  if (same !== undefined) {
    await same.focus();
    return;
  }
  await self.clients.openWindow(target);
}

async function runAction(data: NotificationData, action: string): Promise<void> {
  const sentence = await performAction(fetch, SERVER, data, action);
  const { title, options } = resultNotification(data, sentence);
  await self.registration.showNotification(title, options);
}

// A tap on a button works without opening the app, also on the lock screen; a tap on the
// notification itself opens the page it points to.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = readData(event.notification.data);
  event.waitUntil(event.action === "" ? openLink(data.link) : runAction(data, event.action));
});
