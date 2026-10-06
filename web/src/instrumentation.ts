export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.JOBS === "off") return;
    const { startWorkers } = await import("./lib/jobs");
    await startWorkers().catch((e) => console.error("[jobs] failed to start", e));
  }
}
