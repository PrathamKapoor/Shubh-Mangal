import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { validateDisposableTarget } from "../scripts/postgres-check.mjs";

const enabled = process.env.RUN_POSTGRES_ROLE_CHECK === "true";

test("in-memory role grants restrict synthetic history mutations", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { migrate } = await import("../server/db.mjs");
  const db = new PGlite();
  try {
    await db.waitReady;
    await migrate(db);
    const database = (await db.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database, /^[a-zA-Z0-9_]+$/);
    const sql = await readFile(new URL("../deploy/postgres-roles.sql", import.meta.url), "utf8");
    await db.exec(sql.replace("DATABASE shubh_mangal", `DATABASE "${database}"`));
    await db.exec("SET ROLE shubh_runtime");
    await db.exec("INSERT INTO enquiries(id,data) VALUES('00000000-0000-4000-8000-000000000001','{}')");
    await db.exec("INSERT INTO audit_logs(id,action,entity_id,reason) VALUES('00000000-0000-4000-8000-000000000002','synthetic','fixture','test')");
    for (const operation of ["INSERT INTO schema_migrations(version) VALUES ('synthetic')", "UPDATE schema_migrations SET version=version", "DELETE FROM schema_migrations", "TRUNCATE schema_migrations"]) {
      await assert.rejects(db.exec(operation), (error) => error.code === "42501");
    }
    for (const table of ["audit_logs", "inventory_status_history", "plot_verifications", "price_records"]) {
      for (const operation of [`UPDATE ${table} SET id=id`, `DELETE FROM ${table}`, `TRUNCATE ${table}`, `ALTER TABLE ${table} DISABLE TRIGGER ALL`]) {
        await assert.rejects(db.exec(operation), (error) => error.code === "42501");
      }
    }
    await db.exec("RESET ROLE");
    await assert.rejects(db.exec("TRUNCATE audit_logs"), (error) => error.code === "P0001");
  } finally {
    await db.close();
  }
});

test("PostgreSQL migration owner, runtime permissions, history and recovery", { skip: !enabled, timeout: 120000 }, async () => {
  // Reuse the loopback-only guard; never consult DATABASE_URL or a dotenv file.
  const config = validateDisposableTarget(process.env);
  const { default: pg } = await import("pg");
  const { migrate } = await import("../server/db.mjs");
  const id = randomUUID().replaceAll("-", "");
  const owner = `sr_owner_${id}`;
  const runtime = `sr_app_${id}`;
  const source = `sr_src_${id}`;
  const restored = `sr_dst_${id}`;
  const password = `synthetic_${randomUUID().replaceAll("-", "")}`;
  const roles = [];
  const databases = [];
  const clients = [];
  const quote = (name) => `"${name}"`;
  const makeClient = async (options) => {
    const client = new pg.Client({ ...config, ...options });
    client.on("error", () => {});
    await client.connect();
    clients.push(client);
    return client;
  };
  const dbAdapter = (client) => ({
    query: (sql, args) => client.query(sql, args),
    exec: (sql) => client.query(sql),
    transaction: async (fn) => {
      await client.query("BEGIN");
      try {
        const value = await fn(dbAdapter(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
  });
  const admin = await makeClient({});
  const commandEnv = {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    PGPASSWORD: password,
  };
  const tool = (command, args, input) => {
    const result = spawnSync(command, args, { env: commandEnv, input, timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
    assert.equal(result.status, 0, `${command} failed (or unavailable)`);
    return result.stdout;
  };
  const connectArgs = ["--host", config.host, "--port", String(config.port), "--username", owner];
  let failure;
  try {
    assert.equal(Math.floor(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) / 10000), config.major);
    for (const role of [owner, runtime]) {
      await admin.query(`CREATE ROLE ${quote(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      roles.push(role);
    }
    for (const name of [source, restored]) {
      await admin.query(`CREATE DATABASE ${quote(name)} OWNER ${quote(owner)} TEMPLATE template0`);
      databases.push(name);
    }
    const ownerClient = await makeClient({ database: source, user: owner, password });
    await migrate(dbAdapter(ownerClient));
    await migrate(dbAdapter(ownerClient));
    const expectedMigrations = (await ownerClient.query("SELECT version FROM schema_migrations ORDER BY version")).rows;
    assert.ok(expectedMigrations.length >= 5);
    const rawRoles = await readFile(new URL("../deploy/postgres-roles.sql", import.meta.url), "utf8");
    assert.match(rawRoles, /CREATE ROLE shubh_runtime LOGIN;/);
    assert.match(rawRoles, /GRANT CONNECT ON DATABASE shubh_mangal TO shubh_runtime;/);
    const grants = rawRoles.replace("CREATE ROLE shubh_runtime LOGIN;", "").replaceAll("shubh_runtime", runtime).replace("DATABASE shubh_mangal", `DATABASE ${quote(source)}`);
    await ownerClient.query(grants);
    const app = await makeClient({ database: source, user: runtime, password });
    const identity = (await app.query("SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
    assert.deepEqual(identity, { name: runtime, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false });
    const denied = async (sql, code = "42501") => assert.rejects(app.query(sql), (error) => error.code === code);
    await app.query("INSERT INTO enquiries(id,data) VALUES('00000000-0000-4000-8000-000000000001','{\"name\":\"synthetic\"}')");
    await app.query("UPDATE enquiries SET notes='synthetic update' WHERE id='00000000-0000-4000-8000-000000000001'");
    await app.query("INSERT INTO audit_logs(id,action,entity_id,reason) VALUES('00000000-0000-4000-8000-000000000002','synthetic','fixture','test')");
    for (const operation of ["INSERT INTO schema_migrations(version) VALUES ('synthetic')", "UPDATE schema_migrations SET version=version", "DELETE FROM schema_migrations", "TRUNCATE schema_migrations"]) await denied(operation);
    for (const table of ["audit_logs", "inventory_status_history", "plot_verifications", "price_records"]) {
      await app.query(`SELECT * FROM ${table} LIMIT 1`);
      await denied(`UPDATE ${table} SET id=id`);
      await denied(`DELETE FROM ${table}`);
      await denied(`TRUNCATE ${table}`);
      await denied(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      await assert.rejects(ownerClient.query(`TRUNCATE ${table}`), (error) => error.code === "P0001");
    }
    // Run an actual model publication through the restricted runtime role.
    const {createUser}=await import("../server/auth.mjs");
    const {createApp}=await import("../server/app.mjs");
    const {default:request}=await import("supertest");
    const {geographicToPlan,planToGeographic}=await import("../shared/geography.mjs");
    const layout=JSON.parse(await readFile(new URL("../public/data/layout.json",import.meta.url),"utf8"));
    const loginPassword="Synthetic-role-model-82953!";
    await createUser(dbAdapter(ownerClient),{email:"model-role@example.invalid",name:"Synthetic model owner",password:loginPassword,role:"owner"});
    const origin="http://localhost:5173";
    const runtimeServer=createApp(dbAdapter(app),{origin,demo:false,production:false,logging:false,googleMaps:false});
    const session=request.agent(runtimeServer), login=await session.post("/api/auth/login").set("Origin",origin).send({email:"model-role@example.invalid",password:loginPassword});
    assert.equal(login.status,200);
    const anchor=geographicToPlan({lon:74.909,lat:24.467},layout);
    const outer=[[0,0],[8,0],[8,-5],[5,-5],[5,-8],[0,-8],[0,0]].map(([x,y])=>{const p=planToGeographic({x:anchor.x+x,y:anchor.y+y},layout);return [p.lon,p.lat];});
    const model={title:"Synthetic role building",footprint:{datum:"WGS84",outer,holes:[],source:"Synthetic role survey",sourceRevision:"one"},frame:{physicalAnchor:{lon:74.909,lat:24.467},headingDegrees:0,modelAxes:"right-up-forward",worldAxes:"east-up-south",units:"metres",pivot:[0,0,0]},height:{metres:4,source:"Synthetic height",sourceRevision:"one"},model:{assetId:"synthetic-building",revision:"v1",rights:"Synthetic fixture",correspondence:"Synthetic model outline",dimensions:{width:8,depth:8,cutoutWidth:3,cutoutDepth:3,source:"Synthetic dimensions",sourceRevision:"one"}},verifiedAt:"2026-01-01T00:00:00Z",customerVisible:true};
    for (const [version,publish] of [[0,false],[1,true]]) {
      const response=await session.put("/api/admin/content/synthetic-role-building").set("Origin",origin).set("X-CSRF-Token",login.body.csrf).set("Idempotency-Key",randomUUID()).send({kind:"structure",data:model,expectedVersion:version,publish,reason:"Synthetic restricted role model"});
      assert.equal(response.status,200,JSON.stringify(response.body));
    }
    assert.equal((await request(runtimeServer).get("/api/public/project")).body.items.find((item)=>item.id==="synthetic-role-building")?.published.model?.assetId,"synthetic-building");
    await denied("CREATE TABLE forbidden_synthetic(id integer)");
    await denied("ALTER TABLE enquiries ADD COLUMN forbidden_synthetic integer");
    const archive = tool("pg_dump", [...connectArgs, "--format=custom", "--dbname", source]);
    tool("pg_restore", [...connectArgs, "--exit-on-error", "--no-owner", "--no-acl", "--dbname", restored], archive);
    const recoveryOwner = await makeClient({ database: restored, user: owner, password });
    assert.deepEqual((await recoveryOwner.query("SELECT version FROM schema_migrations ORDER BY version")).rows, expectedMigrations);
    await recoveryOwner.query(grants.replace(`DATABASE ${quote(source)}`, `DATABASE ${quote(restored)}`));
    const recoveryApp = await makeClient({ database: restored, user: runtime, password });
    const restoredServer=createApp(dbAdapter(recoveryApp),{origin,demo:false,production:false,logging:false,googleMaps:false});
    assert.equal((await request(restoredServer).get("/api/public/project")).body.items.find((item)=>item.id==="synthetic-role-building")?.published.model?.assetId,"synthetic-building");
    assert.equal((await recoveryApp.query("SELECT published->'model'->>'assetId' AS id FROM content WHERE id='synthetic-role-building'")).rows[0].id,"synthetic-building");
    assert.equal((await recoveryApp.query("SELECT notes FROM enquiries WHERE id='00000000-0000-4000-8000-000000000001'")).rows[0].notes, "synthetic update");
    assert.equal((await recoveryApp.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id='fixture'")).rows[0].n, 1);
    await assert.rejects(recoveryApp.query("DELETE FROM audit_logs"), (error) => error.code === "42501");
    await assert.rejects(recoveryApp.query("TRUNCATE audit_logs"), (error) => error.code === "42501");
  } catch (error) {
    failure = error;
  } finally {
    for (const client of clients.slice().reverse()) {
      if (client !== admin) await client.end().catch((error) => { failure ??= error; });
    }
    for (const name of databases.reverse()) {
      assert.ok([source, restored].includes(name) && /^sr_(src|dst)_[a-f0-9]{32}$/.test(name));
      await admin.query(`DROP DATABASE ${quote(name)}`).catch((error) => { failure ??= error; });
    }
    for (const role of roles.reverse()) {
      assert.ok([owner, runtime].includes(role) && /^sr_(owner|app)_[a-f0-9]{32}$/.test(role));
      await admin.query(`DROP ROLE ${quote(role)}`).catch((error) => { failure ??= error; });
    }
    await admin.end().catch((error) => { failure ??= error; });
  }
  if (failure) throw failure;
});
