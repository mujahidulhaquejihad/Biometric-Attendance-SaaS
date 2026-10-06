export const VENDOR_LABEL: Record<string, string> = {
  ZKTECO_ADMS: "ZKTeco / eSSL (ADMS push)",
  ZK_PULL: "ZKTeco legacy (LAN pull via agent)",
  HIKVISION: "Hikvision (ISAPI push)",
  SUPREMA_BIOSTAR: "Suprema BioStar 2",
  ANVIZ_CLOUD: "Anviz CrossChex Cloud",
  AGENT: "USB scanner bridge agent",
};

/** ZKTeco FID order, used for every template format so terminals and USB enrollments agree. */
export const FINGERS = ["Left little", "Left ring", "Left middle", "Left index", "Left thumb", "Right thumb", "Right index", "Right middle", "Right ring", "Right little"];

export const isOnline = (d: { lastSeenAt: Date | null }) => !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 15 * 60_000;
