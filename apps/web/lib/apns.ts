import { createHash, sign } from "node:crypto";
import http2 from "node:http2";

export type APNsEnvironment = "sandbox" | "production";
export type APNsConfig = { key: string; keyId: string; teamId: string; bundleId: string };
export type Alert = { title: string; body: string; sound?: "default"; data?: Record<string, string> };
let cached: { fingerprint: string; issuedAt: number; jwt: string } | undefined;

export function apnsConfig(): APNsConfig | undefined {
  const { APNS_KEY_P8: key, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_BUNDLE_ID: bundleId } = process.env;
  if (key && keyId && teamId && bundleId) {
    return { key: key.replace(/\\n/g, "\n"), keyId, teamId, bundleId };
  }
}

export function apnsJWT(config: APNsConfig, now = Math.floor(Date.now() / 1000)): string {
  const fingerprint = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  if (cached?.fingerprint === fingerprint && now >= cached.issuedAt && now - cached.issuedAt < 50 * 60) {
    return cached.jwt;
  }
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: now })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: config.key, dsaEncoding: "ieee-p1363" });
  const jwt = `${unsigned}.${signature.toString("base64url")}`;
  cached = { fingerprint, issuedAt: now, jwt };
  return jwt;
}

export async function sendAPNs(token: string, environment: APNsEnvironment, alert: Alert, config: APNsConfig) {
  const authorization = `bearer ${apnsJWT(config)}`;
  const client = http2.connect(environment === "sandbox"
    ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
  const timeout = setTimeout(() => client.destroy(new Error("APNs request timed out")), 10_000);
  try {
    return await new Promise<{ status: number; reason?: string }>((resolve, reject) => {
      client.on("error", reject);
      client.on("close", () => reject(new Error("APNs connection closed")));
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${encodeURIComponent(token)}`,
        authorization,
        "apns-topic": config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
      let status = 0;
      let body = "";
      request.setEncoding("utf8");
      request.on("response", (headers) => { status = Number(headers[":status"]); });
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("error", reject);
      request.on("aborted", () => reject(new Error("APNs stream aborted")));
      request.on("end", () => {
        let reason: string | undefined;
        try { reason = JSON.parse(body).reason; } catch { /* Successful responses have no body. */ }
        resolve({ status, reason });
      });
      request.end(JSON.stringify({
        ...alert.data,
        aps: { alert: { title: alert.title, body: alert.body }, ...(alert.sound ? { sound: alert.sound } : {}) },
      }));
    });
  } finally {
    clearTimeout(timeout);
    client.close();
    client.destroy();
  }
}
