export type Env = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string;
  GOOGLE_SHEETS_ID: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;   // Carpeta raíz para fotos en Drive
  SHEET_RESP?: string;
  SHEET_TND?: string;
  SHEET_CAT?: string;
  // ── Telegram por tipo ──
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_IDS_PLAGA?: string;
  TELEGRAM_CHAT_IDS_AROMA?: string;
  TELEGRAM_CHAT_IDS_QUIMICO?: string;
  TELEGRAM_CHAT_IDS_DEFAULT?: string;
  // ── n8n Webhooks por tipo ──
  N8N_WEBHOOK_PLAGA?: string;
  N8N_WEBHOOK_AROMA?: string;
  N8N_WEBHOOK_QUIMICO?: string;
};

export function readEnv(): Env {
  const gv = (globalThis as any);
  const e: Record<string, string | undefined> =
    (gv.process && gv.process.env) ? gv.process.env : {};

  const req = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_KEY", "GOOGLE_SHEETS_ID"] as const;
  for (const k of req) {
    if (!e[k]) throw new Error(`Falta variable de entorno: ${k}`);
  }

  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: String(e.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    GOOGLE_SERVICE_ACCOUNT_KEY:   String(e.GOOGLE_SERVICE_ACCOUNT_KEY),
    GOOGLE_SHEETS_ID:             String(e.GOOGLE_SHEETS_ID),
    GOOGLE_DRIVE_FOLDER_ID:       e.GOOGLE_DRIVE_FOLDER_ID,
    SHEET_RESP: e.SHEET_RESP,
    SHEET_TND:  e.SHEET_TND,
    SHEET_CAT:  e.SHEET_CAT,
    TELEGRAM_BOT_TOKEN:        e.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_IDS_PLAGA:   e.TELEGRAM_CHAT_IDS_PLAGA,
    TELEGRAM_CHAT_IDS_AROMA:   e.TELEGRAM_CHAT_IDS_AROMA,
    TELEGRAM_CHAT_IDS_QUIMICO: e.TELEGRAM_CHAT_IDS_QUIMICO,
    TELEGRAM_CHAT_IDS_DEFAULT: e.TELEGRAM_CHAT_IDS_DEFAULT,
    N8N_WEBHOOK_PLAGA:   e.N8N_WEBHOOK_PLAGA,
    N8N_WEBHOOK_AROMA:   e.N8N_WEBHOOK_AROMA,
    N8N_WEBHOOK_QUIMICO: e.N8N_WEBHOOK_QUIMICO,
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

// Scopes: Sheets + Drive
export async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header   = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64url(JSON.stringify({
    iss:   env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now,
  }));
  const unsigned      = `${header}.${claimSet}`;
  const normalizedPem = normalizePem(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const signature     = await signRS256(unsigned, normalizedPem);
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
    "pkcs8", pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return base64url(sig);
}

function pemToArrayBuffer(pem: string) {
  if (!pem.includes('BEGIN PRIVATE KEY')) throw new Error('PEM inválido: falta BEGIN PRIVATE KEY');
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  try {
    const raw   = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  } catch {
    throw new Error('Base64 inválido en la clave. Revisa el private_key.');
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
  if (pem.startsWith('{')) {
    try { const obj = JSON.parse(pem); if (obj.private_key) pem = String(obj.private_key); } catch {}
  }
  if (pem.includes('\\n')) pem = pem.replace(/\\n/g, '\n');
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  if (!pem.includes('BEGIN PRIVATE KEY') || !pem.includes('END PRIVATE KEY')) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no parece un PEM válido.');
  }
  return pem;
}

export function resolveSheetId(v: string) {
  const s = (v || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}

// ══════════════════════════════════════════════════════════════
//  TICKET SECUENCIAL
//  Cuenta filas existentes en la hoja específica para generar
//  el número siguiente. Ej: P1, P2, A5, Q3…
//  Hoja vacía (solo header) → devuelve prefijo + "1"
// ══════════════════════════════════════════════════════════════
export async function getNextTicket(
  token: string,
  sheetId: string,
  tipo: 'plaga' | 'aroma' | 'quimico'
): Promise<string> {
  const prefixMap = { plaga: 'P', aroma: 'A', quimico: 'Q' } as const;
  const sheetMap  = {
    plaga:   'Respuestas_Plaga',
    aroma:   'Respuestas_Aroma',
    quimico: 'Respuestas_Quimico',
  } as const;

  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${sheetMap[tipo]}!A:A`)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return `${prefixMap[tipo]}1`;
    const data  = await res.json();
    const rows  = (data.values || []).length; // incluye header
    const next  = Math.max(1, rows);          // header=1 → siguiente ticket = 1
    return `${prefixMap[tipo]}${next}`;
  } catch {
    return `${prefixMap[tipo]}1`;
  }
}

// ══════════════════════════════════════════════════════════════
//  SUBIR FOTO A GOOGLE DRIVE
//  Recibe base64, mimeType y nombre del archivo.
//  Devuelve la URL pública del archivo en Drive.
// ══════════════════════════════════════════════════════════════
export async function uploadFileToDrive(
  token: string,
  opts: {
    base64: string;   // puede incluir el prefijo "data:image/...;base64,"
    mimeType: string;
    filename: string;
    folderId?: string;
  }
): Promise<string> {
  const { mimeType, filename, folderId } = opts;
  // Limpiar prefijo data-URL si viene incluido
  const base64Clean = opts.base64.includes(',') ? opts.base64.split(',')[1] : opts.base64;

  const metadata: Record<string, any> = { name: filename };
  if (folderId) metadata.parents = [folderId];

  const boundary = 'ArcoprimeUploadBoundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Clean}\r\n` +
    `--${boundary}--`;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!uploadRes.ok) throw new Error(`Drive upload error: ${await uploadRes.text()}`);
  const file = await uploadRes.json();

  // Hacer el archivo visible con el link (reader para anyone)
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return String(file.webViewLink);
}
