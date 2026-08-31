import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  driver: "postgres" | "pglite";
  close: () => Promise<void>;
}

/**
 * DATABASE_URL set → node-postgres; otherwise an embedded PGlite database in
 * `.pglite/` at the repo root (dev convenience — no Docker required).
 */
export async function createDb(databaseUrl = process.env.DATABASE_URL, pgliteDir = ".pglite"): Promise<DbHandle> {
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    /**
     * The pool's settings, stated rather than inherited.
     *
     * `max: 10` is node-postgres's own default and is kept — one server
     * process, and the only transaction in the codebase is two inserts long,
     * so ten clients is not the constraint. Written down so the number is a
     * decision somebody can argue with rather than a default nobody read.
     *
     * `connectionTimeoutMillis` is the one that is CHANGED, and it matters
     * live. The default is 0, which means "wait forever": if every client is
     * busy, a transport command does not fail, it hangs — and a button that
     * never answers is worse mid-show than one that says it could not. Ten
     * seconds rides out a blip and surfaces anything longer as an error a
     * person can see and act on.
     */
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 10_000 });
    /**
     * An idle client failing is expected, not exceptional.
     *
     * Postgres restarts for maintenance, and a managed one restarts on
     * somebody else's schedule. When it does, node-postgres emits `error` on
     * the pool for each idle client it was holding — and an `error` event with
     * no listener is thrown, which this process catches as an UNCAUGHT
     * EXCEPTION and writes to the journal as a crash. So a routine database
     * restart has been arriving in the error log dressed as something far
     * worse, with a stack that points nowhere useful.
     *
     * Handled here so it reads as what it is. The pool discards the dead
     * client and opens another on the next query; nothing else is required.
     */
    pool.on("error", (err) => {
      console.warn("[db] idle client dropped — the pool will reconnect:", err.message);
    });
    return {
      db: drizzlePg(pool, { schema }),
      driver: "postgres",
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = new PGlite(pgliteDir);
  return {
    db: drizzlePglite(pglite, { schema }),
    driver: "pglite",
    close: () => pglite.close(),
  };
}

export { schema };
