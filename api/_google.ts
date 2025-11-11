export type Env = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string; // PEM (private_key del JSON)
  GOOGLE_SHEETS_ID: string;
  SHEET_RESP?: string;
  SHEET_TND?: string;
  SHEET_CAT?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_IDS?: string; // separados por coma
};

// ✅ NUEVO: leer variables desde process.env (Edge las expone así en Vercel)
export function readEnv(): Env {
  const e = (process as any).env || {};
  const req = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_KEY", "GOOGLE_SHEETS_ID"];
  for (const k of req) {
    if (!e[k]) throw new Error(`Falta variable de entorno: ${k}`);
  }
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: String(e.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    GOOGLE_SERVICE_ACCOUNT_KEY: String(e.GOOGLE_SERVICE_ACCOUNT_KEY),
    GOOGLE_SHEETS_ID: String(e.GOOGLE_SHEETS_ID),
    SHEET_RESP: e.SHEET_RESP,
    SHEET_TND: e.SHEET_TND,
    SHEET_CAT: e.SHEET_CAT,
    TELEGRAM_BOT_TOKEN: e.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_IDS: e.TELEGRAM_CHAT_IDS,
  };
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function json(data: any, status: number, req: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

export async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claimSet}`;
  const signature = await signRS256(unsigned, env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || JSON.stringify(out));
  return out.access_token;
}

function base64url(input: string | ArrayBuffer) {
  let str =
    typeof input === "string"
      ? btoa(unescape(encodeURIComponent(input)))
      : btoa(String.fromCharCode(...new Uint8Array(input as ArrayBuffer)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signRS256(unsigned: string, pem: string) {
  const pkcs8 = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  return base64url(sig);
}

function pemToArrayBuffer(pem: string) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export function normalize(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ok(res: Response) {
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}
