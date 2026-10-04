/**
 * Creates (or updates) the restricted login the sync server should use day to
 * day: it can read and write rows in every table, use the sequences, and
 * nothing else — no CREATE, ALTER, DROP, TRUNCATE, no temporary tables, no
 * reading files from the server. Run ONCE, by a person, with the owner login:
 *
 *   OWNER_DATABASE_URL='postgres://…owner…' APP_DB_PASSWORD='…' \
 *     node packages/db/scripts/setup-app-role.ts
 *
 * Then on the sync service set:
 *   MIGRATION_DATABASE_URL = the owner URL (schema changes at boot)
 *   DATABASE_URL           = the same URL with user opencall_app and APP_DB_PASSWORD
 *
 * The password is sent already hashed (SCRAM-SHA-256), so it never appears in
 * the server's logs, and this script never prints it.
 */
import pg from "pg";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const ROLE = process.env.APP_DB_ROLE ?? "opencall_app";

/** A SCRAM-SHA-256 verifier for `password`, the form Postgres stores. */
export function scramVerifier(password: string, iterations = 4096): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** The statements that make ROLE what the app needs and no more. */
export function roleStatements(role: string, verifier: string, database: string): string[] {
  const r = `"${role.replace(/"/g, '""')}"`;
  const db = `"${database.replace(/"/g, '""')}"`;
  return [
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role.replace(/'/g, "''")}') THEN CREATE ROLE ${r} LOGIN; END IF; END $$`,
    `ALTER ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${verifier}'`,
    `GRANT CONNECT ON DATABASE ${db} TO ${r}`,
    `GRANT USAGE ON SCHEMA public TO ${r}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${r}`,
    // Tables the owner creates later (each new migration) come with the same rights.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${r}`,
    // Nobody but the owner creates anything in the schema or the database.
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
    `REVOKE TEMPORARY ON DATABASE ${db} FROM PUBLIC`,
    `REVOKE CREATE ON SCHEMA public FROM ${r}`,
  ];
}

async function main(): Promise<void> {
  const owner = process.env.OWNER_DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!owner || !password) {
    console.error("Set OWNER_DATABASE_URL (the owner login) and APP_DB_PASSWORD (at least 24 characters).");
    process.exit(2);
  }
  if (password.length < 24) {
    console.error("APP_DB_PASSWORD must be at least 24 characters.");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: owner });
  await client.connect();
  const { rows } = await client.query<{ db: string }>("SELECT current_database() AS db");
  for (const statement of roleStatements(ROLE, scramVerifier(password), rows[0]!.db)) await client.query(statement);
  await client.end();
  const url = new URL(owner);
  url.username = ROLE;
  url.password = "APP_DB_PASSWORD";
  console.log(`Role ${ROLE} is ready. Set on the sync service:`);
  console.log(`  MIGRATION_DATABASE_URL = the owner URL you used here`);
  console.log(`  DATABASE_URL           = ${url.toString()}  (put the real password in place of APP_DB_PASSWORD)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
