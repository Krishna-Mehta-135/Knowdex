import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncManager } from "../SyncManager";

class FakeWS {
  static instances: FakeWS[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  sent: unknown[] = [];
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** Simulate the server dropping the connection. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

let win: EventTarget;
let doc: EventTarget & { visibilityState: string };
let nav: { onLine: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  FakeWS.instances = [];
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  nav = { onLine: true };
  vi.stubGlobal("WebSocket", FakeWS);
  vi.stubGlobal(
    "window",
    Object.assign(win, { location: { hostname: "localhost" } }),
  );
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", nav);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function start() {
  const m = new SyncManager("doc-1", async () => "tok");
  await m.init();
  await vi.advanceTimersByTimeAsync(0);
  return m;
}

describe("SyncManager reconnect", () => {
  it("connects on init", async () => {
    const m = await start();
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0]!.url).toContain("/ws/documents/doc-1?token=tok");
    m.destroy();
  });

  it("keeps retrying forever, capping the delay at the maximum", async () => {
    const m = await start();
    for (let i = 0; i < 15; i++) {
      const before = FakeWS.instances.length;
      FakeWS.instances.at(-1)!.drop();
      await vi.advanceTimersByTimeAsync(31_000); // > max backoff (30s)
      expect(FakeWS.instances.length).toBe(before + 1);
    }
    expect(m.getStatus()).not.toBeUndefined();
    m.destroy();
  });

  it("stops retrying while offline and reconnects immediately when back online", async () => {
    const m = await start();
    nav.onLine = false;
    win.dispatchEvent(new Event("offline"));
    expect(m.getStatus()).toBe("error");
    const count = FakeWS.instances.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWS.instances.length).toBe(count); // no reconnect storm while offline

    nav.onLine = true;
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances.length).toBe(count + 1);
    m.destroy();
  });

  it("retryNow reconnects without waiting for the backoff", async () => {
    const m = await start();
    // ramp the backoff up a few steps
    for (let i = 0; i < 4; i++) {
      FakeWS.instances.at(-1)!.drop();
      await vi.advanceTimersByTimeAsync(31_000);
    }
    FakeWS.instances.at(-1)!.drop(); // next retry would be ~16s away
    const count = FakeWS.instances.length;
    m.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances.length).toBeGreaterThan(count);
    m.destroy();
  });

  it("reconnects when a hidden tab becomes visible again", async () => {
    const m = await start();
    FakeWS.instances.at(-1)!.drop();
    const count = FakeWS.instances.length;
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances.length).toBe(count + 1);
    m.destroy();
  });

  it("can be re-initialised after destroy (StrictMode) without duplicate sockets", async () => {
    const m = new SyncManager("doc-1", async () => "tok");
    const first = m.init();
    m.destroy(); // React strict-mode cleanup before the async init resumes
    await m.init();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances).toHaveLength(1);
    m.destroy();
  });

  it("does nothing after destroy", async () => {
    const m = await start();
    m.destroy();
    const count = FakeWS.instances.length;
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWS.instances.length).toBe(count);
  });
});
