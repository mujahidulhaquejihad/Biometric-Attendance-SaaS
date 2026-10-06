/**
 * Hikvision access-control terminals (DS-K1T series) via ISAPI "HTTP listening" event push.
 * Events arrive as JSON or multipart/form-data (JSON part + optional face/finger snapshot).
 */
import type { Device } from "@prisma/client";
import { prisma } from "../db";
import { ingestPunches } from "../punches";

type AcsEvent = {
  eventType?: string;
  dateTime?: string;
  AccessControllerEvent?: {
    majorEventType?: number;
    subEventType?: number;
    employeeNoString?: string;
    currentVerifyMode?: string;
    attendanceStatus?: string;
  };
};

const DIRECTION: Record<string, "IN" | "OUT"> = { checkIn: "IN", breakIn: "IN", overtimeIn: "IN", checkOut: "OUT", breakOut: "OUT", overtimeOut: "OUT" };
const VERIFY = (m?: string) => (!m ? null : /finger/i.test(m) ? "FINGERPRINT" : /face/i.test(m) ? "FACE" : /card/i.test(m) ? "CARD" : m.toUpperCase());

export async function handleHikvision(device: Device & { organizationId: string }, req: Request) {
  const type = req.headers.get("content-type") ?? "";
  let event: AcsEvent | null = null;
  let picture: Uint8Array<ArrayBuffer> | null = null;

  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    for (const [, value] of form) {
      if (typeof value === "string") {
        try {
          const j = JSON.parse(value) as AcsEvent;
          if (j.eventType) event = j;
        } catch {}
      } else if (value.type.startsWith("image/")) {
        picture = new Uint8Array(await value.arrayBuffer());
      }
    }
  } else {
    event = (await req.json().catch(() => null)) as AcsEvent | null;
  }

  const e = event?.AccessControllerEvent;
  // Heartbeats and door/alarm events carry no employee; device is already marked seen.
  if (!event || event.eventType !== "AccessControllerEvent" || !e?.employeeNoString || e.majorEventType !== 5) return 0;

  const timestamp = new Date(event.dateTime ?? Date.now());
  const employeeCode = e.employeeNoString.trim();
  const n = await ingestPunches(
    { orgId: device.organizationId, deviceId: device.id, deviceName: device.name, source: "DEVICE" },
    [{ employeeCode, timestamp, direction: DIRECTION[e.attendanceStatus ?? ""] ?? null, verifyMode: VERIFY(e.currentVerifyMode) }],
  );
  if (n && picture && picture.length < 2_000_000) {
    await prisma.punchPhoto.create({ data: { organizationId: device.organizationId, deviceId: device.id, employeeCode, timestamp, data: picture } });
  }
  return n;
}
