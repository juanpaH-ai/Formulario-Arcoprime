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
  // ✅ Compatible con Edge y Node sin @types/node
  const gv = (globalThis as any);
  const e: Record<string, string | undefined> =
    (gv.process && gv.process.env) ? gv.process.env : {};

  const req = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_KEY", "GOOGLE_SHEETS_ID"] as const;
  for (const k of req) {
    if (!e[k]) {
      throw new Error(`Falta variable de entorno: ${k}`);
    }
  }

  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: String(e.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    GOOGLE_SERVICE_ACCOUNT_KEY:   String(e.GOOGLE_SERVICE_ACCOUNT_KEY),
    GOOGLE_SHEETS_ID:             String(e.GOOGLE_SHEETS_ID),
    SHEET_RESP: e.SHEET_RESP,
    SHEET_TND:  e.SHEET_TND,
    SHEET_CAT:  e.SHEET_CAT,
    TELEGRAM_BOT_TOKEN: e.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_IDS:  e.TELEGRAM_CHAT_IDS,
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

  // ⬇️ normalizamos aquí
  const normalizedPem = normalizePem(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const signature = await signRS256(unsigned, normalizedPem);
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
  if (!pem.includes('BEGIN PRIVATE KEY')) {
    throw new Error('PEM inválido: falta BEGIN PRIVATE KEY');
  }
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  try {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  } catch {
    throw new Error('Base64 inválido en la clave. Revisa saltos de línea o copia/pegado del private_key.');
  }
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
function normalizePem(pemRaw: string): string {
  if (!pemRaw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY vacío');

  let pem = pemRaw.trim();

  // Caso 1: pegaron el JSON completo del SA
  if (pem.startsWith('{')) {
    try {
      const obj = JSON.parse(pem);
      if (obj.private_key) pem = String(obj.private_key);
    } catch {}
  }

  // Caso 2: viene con "\n" literales -> convertir a saltos reales
  if (pem.includes('\\n')) {
    pem = pem.replace(/\\n/g, '\n');
  }

  // Quitar comillas envolventes si quedaron
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }

  // Validación rápida
  if (!pem.includes('BEGIN PRIVATE KEY') || !pem.includes('END PRIVATE KEY')) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no parece un PEM válido (falta BEGIN/END). Revisa la variable de entorno.');
  }
  return pem;
}
export function resolveSheetId(v: string) {
  const s = (v || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}
