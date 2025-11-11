import { readEnv, corsHeaders, getAccessToken, json, ok, resolveSheetId } from "./_google";

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "GET") {
    return json({ ok: false, error: "Método no permitido" }, 405, req);
  }

  try {
    const env = readEnv();
    const token = await getAccessToken(env);
    const SHEET_TND = env.SHEET_TND || "Tiendas";
    const SHEET_CAT = env.SHEET_CAT || "Catalogos";
    const id = resolveSheetId(env.GOOGLE_SHEETS_ID);

    // Tiendas A2:B
    const tiendasRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${SHEET_TND}!A2:B`)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!tiendasRes.ok) throw new Error(`Tiendas error: ${await tiendasRes.text()}`);
    const tiendasJson = await tiendasRes.json();
    const tiendas = (tiendasJson.values || [])
      .map((r: string[]) => ({ id: String(r[0] || ""), nombre: String(r[1] || "") }))
      .filter((t: any) => t.id && t.nombre);

    // Helper para columnas sueltas
    async function col(range: string) {
      const r = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error(`${range} error: ${await r.text()}`);
      const j = await r.json();
      return (j.values || []).map((v: string[]) => v[0]).filter(Boolean);
    }

    const tipoEvento      = await col(`${SHEET_CAT}!A2:A`);
    const tipoEventoPlaga = await col(`${SHEET_CAT}!C2:C`);
    const tipoPlaga       = await col(`${SHEET_CAT}!E2:E`);
    const sectores        = await col(`${SHEET_CAT}!G2:G`);
    const catAroma        = await col(`${SHEET_CAT}!I2:I`);
    const catQuimico      = await col(`${SHEET_CAT}!K2:K`);

    return json(
      { ok: true, tiendas, tipoEvento, tipoEventoPlaga, tipoPlaga, sectores, catAroma, catQuimico },
      200,
      req
    );
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Error interno" }, 500, req);
  }
}
