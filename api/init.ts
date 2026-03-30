import { readEnv, corsHeaders, getAccessToken, json, resolveSheetId } from "./_google";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "GET") {
    return json({ ok: false, error: "Método no permitido" }, 405, req);
  }

  try {
    const env      = readEnv();
    const token    = await getAccessToken(env);
    const id       = resolveSheetId(env.GOOGLE_SHEETS_ID);
    const SHEET_TND = env.SHEET_TND || "Tiendas";
    const SHEET_CAT = env.SHEET_CAT || "Catalogos";

    // ══════════════════════════════════════════════════════
    //  Una sola llamada batchGet para todas las columnas
    //  de catálogos → evita el límite de 60 req/min
    // ══════════════════════════════════════════════════════
    const catRanges = [
      `${SHEET_CAT}!A2:A`,  // tipoEvento
      `${SHEET_CAT}!C2:C`,  // tipoEventoPlaga
      `${SHEET_CAT}!E2:E`,  // tipoPlaga
      `${SHEET_CAT}!G2:G`,  // sectores
      `${SHEET_CAT}!I2:I`,  // catAroma
      `${SHEET_CAT}!K2:K`,  // catQuimico
      `${SHEET_CAT}!L2:L`,  // R1_Respuestas
      `${SHEET_CAT}!M2:M`,  // C5_Respuestas
      `${SHEET_CAT}!N2:N`,  // M4_Respuestas
      `${SHEET_CAT}!O2:O`,  // H4_Respuestas
      `${SHEET_CAT}!P2:P`,  // P1_Respuestas
    ];

    const rangesParam = catRanges.map(r => `ranges=${encodeURIComponent(r)}`).join("&");

    // Llamada 1: tiendas
    // Llamada 2: todos los catálogos en batch
    const [tiendasRes, batchRes] = await Promise.all([
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${SHEET_TND}!A2:B`)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ),
      fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${rangesParam}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ),
    ]);

    if (!tiendasRes.ok) throw new Error(`Tiendas error: ${await tiendasRes.text()}`);
    if (!batchRes.ok)   throw new Error(`Catálogos error: ${await batchRes.text()}`);

    const tiendasJson = await tiendasRes.json();
    const batchJson   = await batchRes.json();

    // Parsear tiendas
    const tiendas = (tiendasJson.values || [])
      .map((r: string[]) => ({ id: String(r[0] || ""), nombre: String(r[1] || "") }))
      .filter((t: any) => t.id && t.nombre);

    // Helper para extraer una columna del batch
    const vr = batchJson.valueRanges || [];
    function extractCol(index: number): string[] {
      return ((vr[index]?.values || []) as string[][]).map(v => v[0]).filter(Boolean);
    }

    return json(
      {
        ok:              true,
        tiendas,
        tipoEvento:      extractCol(0),
        tipoEventoPlaga: extractCol(1),
        tipoPlaga:       extractCol(2),
        sectores:        extractCol(3),
        catAroma:        extractCol(4),
        catQuimico:      extractCol(5),
        R1_Respuestas:   extractCol(6),
        C5_Respuestas:   extractCol(7),
        M4_Respuestas:   extractCol(8),
        H4_Respuestas:   extractCol(9),
        P1_Respuestas:   extractCol(10),
      },
      200,
      req
    );
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Error interno" }, 500, req);
  }
}
