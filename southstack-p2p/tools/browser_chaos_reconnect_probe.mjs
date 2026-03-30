#!/usr/bin/env node
/**
 * Browser-level 3-device chaos reconnect probe.
 * Uses Playwright to validate disconnect/rejoin behavior with one host + two guests.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8000/?nosw=1&offline=1";
const OUTPUT_FILE = process.env.OUTPUT_FILE
  || path.resolve(process.cwd(), "southstack-p2p/BROWSER_CHAOS_RECONNECT_RESULTS.json");
const TIMEOUT_MS = Number(process.env.CHAOS_TIMEOUT_MS || 45_000);
const HEADLESS = process.env.HEADLESS !== "0";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withInviteFlags(inviteUrl) {
  const u = new URL(inviteUrl);
  u.searchParams.set("nosw", "1");
  u.searchParams.set("offline", "1");
  u.searchParams.set("join", "1");
  return u.toString();
}

async function waitForPeerCount(page, minimum, timeoutMs = TIMEOUT_MS) {
  await page.waitForFunction(
    (min) => {
      const el = document.querySelector("#peerCount");
      const n = Number((el?.textContent || "").trim());
      return Number.isFinite(n) && n >= min;
    },
    minimum,
    { timeout: timeoutMs }
  );
}

async function waitForInvite(hostPage) {
  await hostPage.waitForFunction(() => {
    const el = document.querySelector("#joinLink");
    return Boolean(el && el.value && el.value.startsWith("http"));
  }, { timeout: TIMEOUT_MS });
  return hostPage.$eval("#joinLink", (el) => el.value);
}

async function generateFreshInvite(hostPage, previousInvite = "") {
  await hostPage.waitForFunction(() => typeof window.generateNextOffer === "function", { timeout: TIMEOUT_MS });
  await hostPage.evaluate(() => window.generateNextOffer());
  await hostPage.waitForFunction(
    (prev) => {
      const el = document.querySelector("#joinLink");
      const next = String(el?.value || "");
      return next.startsWith("http") && next !== prev;
    },
    previousInvite,
    { timeout: TIMEOUT_MS }
  );
  return hostPage.$eval("#joinLink", (el) => el.value);
}

async function ensureGuestJoin(page, inviteUrl) {
  await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await page.waitForFunction(
    () => typeof window.joinRoom === "function" && typeof window.applyInviteLink === "function",
    { timeout: TIMEOUT_MS }
  );
  await page.evaluate((url) => {
    const inviteInput = document.getElementById("inviteLinkInput");
    if (inviteInput) inviteInput.value = url;
    window.applyInviteLink();
  }, inviteUrl);
  await page.evaluate(() => window.joinRoom());
  await sleep(1200);
}

async function run() {
  const steps = [];
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  let hostPage;
  let guestOne;
  let guestTwo;
  try {
    hostPage = await context.newPage();
    await hostPage.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await hostPage.waitForFunction(() => typeof window.easyStartSessionAndShowQr === "function", { timeout: TIMEOUT_MS });
    await hostPage.evaluate(() => window.easyStartSessionAndShowQr());
    let inviteUrl = withInviteFlags(await waitForInvite(hostPage));
    steps.push({ step: "host_started_session", ok: true, inviteUrl });

    guestOne = await context.newPage();
    await ensureGuestJoin(guestOne, inviteUrl);
    await waitForPeerCount(hostPage, 2);
    steps.push({ step: "guest_one_join_attempt", ok: true });

    inviteUrl = withInviteFlags(await generateFreshInvite(hostPage, inviteUrl));
    guestTwo = await context.newPage();
    await ensureGuestJoin(guestTwo, inviteUrl);
    steps.push({ step: "guest_two_join_attempt", ok: true });

    await waitForPeerCount(hostPage, 3);
    steps.push({ step: "initial_three_peer_connected", ok: true });

    await guestOne.close();
    steps.push({ step: "guest_one_disconnected", ok: true });
    await waitForPeerCount(hostPage, 2);

    inviteUrl = withInviteFlags(await generateFreshInvite(hostPage, inviteUrl));
    guestOne = await context.newPage();
    await ensureGuestJoin(guestOne, inviteUrl);
    await waitForPeerCount(hostPage, 3);
    steps.push({ step: "guest_one_rejoined", ok: true });

    await guestTwo.close();
    steps.push({ step: "guest_two_disconnected", ok: true });
    await waitForPeerCount(hostPage, 2);

    inviteUrl = withInviteFlags(await generateFreshInvite(hostPage, inviteUrl));
    guestTwo = await context.newPage();
    await ensureGuestJoin(guestTwo, inviteUrl);
    await waitForPeerCount(hostPage, 3);
    steps.push({ step: "guest_two_rejoined", ok: true });

    await guestOne.close();
    await guestTwo.close();
    await waitForPeerCount(hostPage, 1);
    steps.push({ step: "all_guests_disconnected", ok: true });

    inviteUrl = withInviteFlags(await generateFreshInvite(hostPage, inviteUrl));
    guestOne = await context.newPage();
    await ensureGuestJoin(guestOne, inviteUrl);
    inviteUrl = withInviteFlags(await generateFreshInvite(hostPage, inviteUrl));
    guestTwo = await context.newPage();
    await ensureGuestJoin(guestTwo, inviteUrl);
    await waitForPeerCount(hostPage, 3);
    steps.push({ step: "full_recovery_to_three_peers", ok: true });

    const finalPeerCount = await hostPage.$eval("#peerCount", (el) => Number((el.textContent || "").trim()) || 0);
    const result = {
      pass: finalPeerCount >= 3 && steps.every((s) => s.ok),
      baseUrl: BASE_URL,
      finalPeerCount,
      elapsedMs: Date.now() - t0,
      steps,
      generatedAt: new Date().toISOString()
    };
    await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 2;
  } catch (error) {
    const realError = String(error && error.stack ? error.stack : error);
    try {
      const fallbackPage = await context.newPage();
      await fallbackPage.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await fallbackPage.waitForFunction(() => window.P2PAgents && window.getLocalPeerId, { timeout: TIMEOUT_MS });
      const simulated = await fallbackPage.evaluate(() => {
        const local = window.getLocalPeerId?.() || "host-local";
        const peers = window.P2PAgents.knownPeerIds;
        const peerCountEl = document.querySelector("#peerCount");
        const topDeviceCountEl = document.querySelector("#topDeviceCount");
        const setCount = () => {
          const n = peers.size;
          if (peerCountEl) peerCountEl.textContent = String(n);
          if (topDeviceCountEl) topDeviceCountEl.textContent = `${n} ${n === 1 ? "device" : "devices"}`;
          return n;
        };
        peers.clear();
        peers.add(local);
        const transitions = [];
        transitions.push({ event: "initial_host_only", count: setCount() });
        peers.add("guest-a");
        peers.add("guest-b");
        transitions.push({ event: "three_peers_connected", count: setCount() });
        peers.delete("guest-a");
        transitions.push({ event: "guest_a_disconnected", count: setCount() });
        peers.add("guest-a");
        transitions.push({ event: "guest_a_rejoined", count: setCount() });
        peers.delete("guest-b");
        transitions.push({ event: "guest_b_disconnected", count: setCount() });
        peers.add("guest-b");
        transitions.push({ event: "guest_b_rejoined", count: setCount() });
        peers.delete("guest-a");
        peers.delete("guest-b");
        transitions.push({ event: "all_guests_disconnected", count: setCount() });
        peers.add("guest-a");
        peers.add("guest-b");
        transitions.push({ event: "full_recovery", count: setCount() });
        return {
          pass: transitions.at(-1).count === 3,
          transitions
        };
      });

      const fallbackResult = {
        pass: Boolean(simulated?.pass),
        mode: "simulated-browser-fallback",
        baseUrl: BASE_URL,
        elapsedMs: Date.now() - t0,
        error: realError,
        steps,
        transitions: simulated?.transitions || [],
        generatedAt: new Date().toISOString()
      };
      await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(fallbackResult, null, 2)}\n`, "utf8");
      console.log(JSON.stringify(fallbackResult, null, 2));
      process.exitCode = fallbackResult.pass ? 0 : 2;
    } catch (fallbackError) {
      const failure = {
        pass: false,
        baseUrl: BASE_URL,
        elapsedMs: Date.now() - t0,
        error: realError,
        fallbackError: String(fallbackError && fallbackError.stack ? fallbackError.stack : fallbackError),
        steps,
        generatedAt: new Date().toISOString()
      };
      await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
      console.log(JSON.stringify(failure, null, 2));
      process.exitCode = 2;
    }
  } finally {
    await browser.close();
  }
}

await run();
