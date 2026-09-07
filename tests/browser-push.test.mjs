import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./helpers/load-module.mjs";

function browserFixture({ permission = "granted", existing = true, saveStatus = 200, keyStatus = 200, rotatedKey = false, subscriptionFails = false } = {}) {
  const calls = [];
  const publicKey = Uint8Array.from([4, 1, 2, 3]);
  const state = { permission, session: "first-session", boundSession: null, prompted: 0, subscribed: 0, unsubscribed: 0, saveStatus };
  const makeSubscription = (key) => ({
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/test", keys: { p256dh: "public", auth: "auth" } }),
    unsubscribe: async () => { state.unsubscribed++; return true; }
  });
  let subscription = existing ? makeSubscription(rotatedKey ? Uint8Array.from([4, 5, 6, 7]) : publicKey) : null;
  const registration = { pushManager: {
    getSubscription: async () => subscription,
    subscribe: async (options) => {
      state.subscribed++;
      if (subscriptionFails) throw new Error("Subscription failed");
      subscription = makeSubscription(options.applicationServerKey);
      return subscription;
    }
  } };
  const Notification = {
    get permission() { return state.permission; },
    requestPermission: async () => { state.prompted++; return state.permission; }
  };
  const client = loadModule("lib/browser-push.ts", {}, {
    window: { Notification, PushManager: {}, atob: (value) => Buffer.from(value, "base64").toString("binary") },
    navigator: { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } },
    Notification,
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/api/push/public-key") return new Response(JSON.stringify({ publicKey: Buffer.from(publicKey).toString("base64url") }), { status: keyStatus });
      if (state.saveStatus === 200) state.boundSession = state.session;
      return new Response("{}", { status: state.saveStatus });
    }
  });
  return { ...client, calls, state };
}

test("existing browser subscriptions are rebound after login and password session rotation", async () => {
  const client = browserFixture();
  assert.equal(await client.synchronizePushSubscription(), "enabled");
  assert.equal(client.state.boundSession, "first-session");
  client.state.boundSession = null;
  client.state.session = "new-session";
  assert.equal(await client.synchronizePushSubscription(), "enabled");
  assert.equal(client.state.boundSession, "new-session");
  assert.equal(client.state.prompted, 0);
  assert.equal(client.state.subscribed, 0);
});

test("granted permission recreates a subscription removed on logout", async () => {
  const client = browserFixture({ existing: false });
  assert.equal(await client.synchronizePushSubscription(), "enabled");
  assert.equal(client.state.subscribed, 1);
  assert.equal(client.state.prompted, 0);
  assert.equal(client.calls.at(-1).options.method, "POST");
});

test("permission alone never reports enabled after a failed server binding", async () => {
  const client = browserFixture({ saveStatus: 401 });
  await assert.rejects(client.synchronizePushSubscription(), /提醒订阅保存失败/);
  assert.equal(client.state.boundSession, null);
  client.state.saveStatus = 200;
  assert.equal(await client.synchronizePushSubscription(), "enabled");
});

test("automatic restoration never asks for permission and unsupported clients stay disabled", async () => {
  for (const permission of ["default", "denied"]) {
    const client = browserFixture({ permission });
    assert.equal(await client.synchronizePushSubscription(), "disabled");
    assert.equal(client.state.prompted, 0);
    assert.equal(client.calls.length, 0);
    await client.synchronizePushSubscription(true);
    assert.equal(client.state.prompted, 1);
  }
  const unsupported = loadModule("lib/browser-push.ts", {}, { window: {}, navigator: {} });
  assert.equal(await unsupported.synchronizePushSubscription(), "unsupported");
});

test("changed VAPID keys recreate browser subscriptions and configuration failures remain failures", async () => {
  const client = browserFixture({ rotatedKey: true });
  assert.equal(await client.synchronizePushSubscription(), "enabled");
  assert.equal(client.state.unsubscribed, 1);
  assert.equal(client.state.subscribed, 1);
  const configFailure = browserFixture({ keyStatus: 403 });
  await assert.rejects(configFailure.synchronizePushSubscription(), /无法读取提醒配置/);
  assert.equal(configFailure.calls.length, 1);
  const browserFailure = browserFixture({ existing: false, subscriptionFails: true });
  await assert.rejects(browserFailure.synchronizePushSubscription(), /Subscription failed/);
  assert.equal(browserFailure.state.boundSession, null);
});
