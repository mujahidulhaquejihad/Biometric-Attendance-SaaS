"use client";
import { useEffect, useState } from "react";
import { AGENT_WS } from "@/components/client";

type Result = { kind: "punch"; name: string; time: string } | { kind: "unknown" };

/** Full-screen check-in display for a PC with a USB scanner; the bridge agent does capture and matching. */
export default function KioskPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [connected, setConnected] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let clear: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(AGENT_WS);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        retry = setTimeout(connect, 3000);
      };
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.type !== "punch" && d.type !== "unknown") return;
        setResult(d.type === "punch" ? { kind: "punch", name: d.name, time: d.time } : { kind: "unknown" });
        clearTimeout(clear);
        clear = setTimeout(() => setResult(null), 4000);
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      clearTimeout(clear);
      ws.onclose = null;
      ws.close();
    };
  }, []);

  const tone = result?.kind === "punch" ? "bg-green-600" : result?.kind === "unknown" ? "bg-red-600" : "bg-slate-900";
  return (
    <main className={`flex min-h-screen flex-col items-center justify-center gap-8 text-white transition-colors ${tone}`}>
      <div className="text-8xl font-light tabular-nums">{now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      <div className="text-2xl opacity-80">{now?.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
      <div role="status" aria-live="assertive" className="min-h-24 text-center">
        {result?.kind === "punch" && (
          <>
            <div className="text-5xl font-semibold">{result.name}</div>
            <div className="mt-2 text-2xl">Recorded at {new Date(result.time).toLocaleTimeString()}</div>
          </>
        )}
        {result?.kind === "unknown" && <div className="text-4xl font-semibold">Fingerprint not recognised. Try again.</div>}
        {!result && <div className="text-3xl opacity-70">{connected ? "Place your finger on the scanner" : "Scanner offline. Waiting for bridge agent…"}</div>}
      </div>
    </main>
  );
}
