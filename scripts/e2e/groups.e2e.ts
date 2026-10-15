/** Real group UI + SDK + PostgreSQL/RLS. Auth and HTTP routing are explicitly
 * local fixtures; this does not certify hosted Supabase Auth/PostgREST/Realtime. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import { createServer as createViteServer } from "vite";
import { Pool } from "pg";
import { launchChrome, restrictToLocalNetwork } from "./harness";
import { localDatabase } from "../audit/localDatabase";
if (process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY)
  throw new Error("Local fixture only.");
const fixture = await localDatabase();
const files = await mkdtemp(path.join(os.tmpdir(), "kentro-group-media-"));
const pool = new Pool({ connectionString: fixture.url });
const users = ["alice", "bob"].map((username, i) => ({
  id: `80000000-0000-4000-8000-00000000000${i + 1}`,
  aud: "authenticated",
  role: "authenticated",
  email: username + "@example.invalid",
  user_metadata: { username },
  app_metadata: { provider: "email" },
  identities: [],
  created_at: new Date().toISOString(),
}));
for (const user of users)
  await fixture.db.query(
    "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
    [user.id, user.email, user.user_metadata],
  );
const tokens = new Map(
  users.map((user) => {
    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 7200,
      }),
    ).toString("base64url");
    return [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        payload +
        ".explicit-local-fixture",
      user,
    ] as const;
  }),
);
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((q, r, next) => {
  r.setHeader("Access-Control-Allow-Origin", "*");
  r.setHeader("Access-Control-Allow-Headers", "*");
  r.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (q.method === "OPTIONS") return void r.sendStatus(204);
  next();
});
app.use((q, r, next) => {
  const user = tokens.get(
    String(q.headers.authorization || "").replace(/^Bearer /, ""),
  );
  if (!user)
    return void r.status(401).json({ message: "Unknown local fixture token" });
  r.locals.user = user;
  next();
});
app.get("/auth/v1/user", (_q, r) => r.json(r.locals.user));
app.get("/rest/v1/:table", async (q, r) => {
  if (q.params.table === "profiles")
    return void r.json(
      (
        await fixture.db.query(
          'select username,"usernameLower","ownerId",elo from profiles',
        )
      ).rows,
    );
  if (["friends", "global_chat", "private_messages"].includes(q.params.table))
    return void r.json([]);
  r.status(404).json({ message: "Fixture table not exposed" });
});
app.post("/rest/v1/rpc/:fn", async (q, r) => {
  const allowed: Record<string, string> = {
    kentro_group_list: "select kentro_group_list() as result",
    kentro_group_feed: "select kentro_group_feed($1) as result",
    kentro_group_action: "select kentro_group_action($1,$2,$3) as result",
  };
  const sql = allowed[q.params.fn];
  if (!sql) return void r.status(404).json({ message: "RPC not exposed" });
  const args =
    q.params.fn === "kentro_group_list"
      ? []
      : q.params.fn === "kentro_group_feed"
        ? [q.body.p_group]
        : [q.body.p_group, q.body.p_action, q.body.p_data];
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      r.locals.user.id,
    ]);
    const result = (await client.query(sql, args)).rows[0].result;
    await client.query("commit");
    r.json(result);
  } catch (error) {
    await client.query("rollback");
    r.status(403).json({ message: (error as Error).message });
  } finally {
    client.release();
  }
});
const adapter = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => adapter.once("listening", resolve));
const adapterUrl = "http://127.0.0.1:" + (adapter.address() as any).port;
const vite = await createViteServer({
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(adapterUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      "explicit-local-fixture",
    ),
  },
  server: { host: "127.0.0.1", port: 0, hmr: false },
  logLevel: "error",
});
await vite.listen();
const origin = "http://127.0.0.1:" + (vite.httpServer!.address() as any).port;
const browser = await launchChrome();
async function pageFor(name: string) {
  const page = await (await browser.createBrowserContext()).newPage();
  await restrictToLocalNetwork(page);
  page.on("pageerror", (error) =>
    console.error("Browser error", String(error)),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("Browser console", message.text());
  });
  const entry = [...tokens].find(([, u]) => u.user_metadata.username === name)!;
  await page.evaluateOnNewDocument(
    (session) =>
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session)),
    {
      access_token: entry[0],
      refresh_token: "local-unused-refresh",
      token_type: "bearer",
      expires_in: 7200,
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      user: entry[1],
    },
  );
  await page.goto(origin + "/scripts/e2e/fixtures/groups.html?user=" + name, {
    waitUntil: "domcontentloaded",
  });
  return page;
}
async function clickText(page: any, text: string) {
  const handle = await page.evaluateHandle(
    (needle: string) =>
      Array.from(document.querySelectorAll("button")).find(
        (b: any) =>
          b.getClientRects().length &&
          b.innerText.trim().toLowerCase() === needle.toLowerCase(),
      ) || null,
    text,
  );
  const element = handle.asElement();
  assert.ok(element, "Button " + text);
  await element.click();
  await handle.dispose();
}
async function text(page: any, value: string) {
  try {
    await page.waitForFunction(
      (needle: string) => document.body.innerText.includes(needle),
      { timeout: 15000 },
      value,
    );
  } catch (error) {
    console.error(
      "Expected:",
      value,
      "Body:",
      await page.evaluate(() => document.body.innerText),
    );
    throw error;
  }
}
try {
  const alice = await pageFor("alice"),
    bob = await pageFor("bob");
  await text(alice, "New Group");
  await clickText(alice, "New Group");
  await alice.waitForSelector("#group-name");
  await alice.type("#group-name", "Persistent browser club");
  await alice.type('[aria-label="Invite username"]', "bob");
  await clickText(alice, "Add");
  await clickText(alice, "Create Tactical Group");
  await alice.waitForFunction(() => !document.querySelector("#group-name"), {
    timeout: 10000,
  });
  await text(bob, "Invitation to Persistent browser club");
  await clickText(bob, "Accept invitation");
  await text(bob, "Persistent browser club");
  await text(alice, "Persistent browser club");
  const composer = 'input[placeholder="Message Persistent browser club..."]';
  await alice.waitForSelector(composer);
  await alice.type(composer, "Group message survives reload");
  await alice.keyboard.press("Enter");
  await text(bob, "Group message survives reload");
  await bob.reload({ waitUntil: "domcontentloaded" });
  await text(bob, "Persistent browser club");
  // Select the actual persisted conversation after reloading the app.
  await bob.click('[aria-label="Open Persistent browser club"]');
  await text(bob, "Group message survives reload");
  const oversized = path.join(files, 'oversized.png');
  await writeFile(oversized, Buffer.alloc(120001));
  const upload = await alice.$('input[type="file"]'); assert.ok(upload);
  await upload.uploadFile(oversized); await text(alice, 'up to 120 KB');
  await alice.evaluate(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await capture(constraints); (window as any).__recordingTracks = stream.getTracks(); return stream;
    };
  });
  await alice.click('[title="Record Voice Note"]');
  await alice.waitForFunction(() => (window as any).__recordingTracks?.length > 0);
  await alice.click('[aria-label="Open Grandmaster Hall"]');
  await alice.waitForFunction(() => (window as any).__recordingTracks.every((track:MediaStreamTrack) => track.readyState === 'ended'));
  const rows = (
    await fixture.db.query(
      'select m.text,p.username from kentro_group_messages m join profiles p on p."ownerId"=m.sender_id',
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "alice");
  console.log(
    "PASS two Chromium contexts: actual lounge creates persistent group, invites, recipient accepts, canonical message crosses browsers and survives reload; oversized attachments are rejected and changing chats releases a real fake-device microphone. Local Auth/HTTP fixture; hosted Supabase: PENDING.",
  );
} finally {
  await browser.close();
  await vite.close();
  await new Promise<void>((r) => adapter.close(() => r()));
  await pool.end();
  await fixture.close();
  await rm(files, {recursive:true,force:true});
}
