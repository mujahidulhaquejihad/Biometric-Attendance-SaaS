import { EventEmitter } from "node:events";
import { Client } from "pg";
import { prisma } from "./db";

const g = globalThis as unknown as { liveBus?: EventEmitter };

/** Process-wide bus fed by Postgres LISTEN, so every instance sees every event. */
export function liveBus() {
  if (g.liveBus) return g.liveBus;
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  g.liveBus = bus;
  const connect = () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.on("notification", (m) => {
      try {
        bus.emit("event", JSON.parse(m.payload ?? "{}"));
      } catch {}
    });
    c.on("error", (e) => {
      console.error("[live] listener error, reconnecting", e.message);
      c.end().catch(() => {});
      setTimeout(connect, 5000);
    });
    c.connect()
      .then(() => c.query("LISTEN live"))
      .catch((e) => {
        console.error("[live] connect failed", e.message);
        setTimeout(connect, 5000);
      });
  };
  connect();
  return bus;
}

export async function publish(evt: Record<string, unknown>) {
  await prisma.$executeRaw`SELECT pg_notify('live', ${JSON.stringify(evt)})`;
}
