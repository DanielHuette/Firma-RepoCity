// Push on this device: asks for permission, subscribes with the sender key of the Cockpit and
// registers the device, so messages arrive on the lock screen even with the app closed.
import { pushKey, removeDevice, saveDevice } from "../api/cockpit";
import { fromBase64Url } from "./base64";

export type PushState = "unsupported" | "blocked" | "off" | "on";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) === null ? "off" : "on";
}

/** A name Daniel recognises in the device list. */
export function deviceName(userAgent = navigator.userAgent): string {
  const system = /Android/i.test(userAgent) ? "Android-Handy" : /iPhone|iPad/i.test(userAgent) ? "iPhone"
    : /Windows/i.test(userAgent) ? "Windows-PC" : /Mac OS/i.test(userAgent) ? "Mac" : "Gerät";
  const browser = userAgent.includes("Edg/") ? "Edge" : userAgent.includes("Firefox/") ? "Firefox" : userAgent.includes("Chrome/") ? "Chrome"
    : userAgent.includes("Safari/") ? "Safari" : "Browser";
  return `${system} · ${browser}`;
}

export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const registration = await navigator.serviceWorker.ready;
  const key = fromBase64Url(await pushKey());
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with another sender key cannot receive our messages.
  const existingKey = subscription?.options.applicationServerKey;
  if (subscription !== null && existingKey != null && !sameBytes(new Uint8Array(existingKey), key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveDevice(subscription.toJSON(), deviceName());
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription !== null) {
    await removeDevice(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return "off";
}

export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  return (await currentSubscription())?.endpoint ?? null;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
