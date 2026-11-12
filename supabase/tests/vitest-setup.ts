// The database tests stop their embedded Postgres in afterAll. A pool can still hold an idle
// connection at that moment; Postgres then closes it with "terminating connection due to
// administrator command" (57P01), and a pool without an error listener turns that into an unhandled
// error that fails the run. Ignore exactly that error, only on pools that have no listener of their own.
import pg from "pg";

const emit = pg.Pool.prototype.emit;
pg.Pool.prototype.emit = function (this: pg.Pool, event: string | symbol, ...args: unknown[]) {
  if (event === "error" && (args[0] as { code?: string } | undefined)?.code === "57P01" && this.listenerCount("error") === 0) return true;
  return emit.call(this, event, ...args);
};
