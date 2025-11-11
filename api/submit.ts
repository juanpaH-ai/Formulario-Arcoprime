import { readEnv, corsHeaders, getAccessToken, json, normalize, resolveSheetId } from "./_google";

export const config = { runtime: "edge" };

const RESP_HEADERS = [
  'Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento',
  'Nombre','Apellido','Tipo_Evento',
  'Tipo_Evento_Plaga','Tipo_Plaga','Sector_Hallazgo','Comentario_Plaga',
  'Dosif_inco_Aroma','Equip_malo_Aroma','Hurto_Equip_Aroma','Comentario_Aroma',
  'Falla_Dil_Quimico','Otra_Inci_Quimico','Problema_Ped_Quimico','Comentario_Quimicos','Submitter_IP'
];

const HDR_PLAGA = [
  'Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento','Nombre','Apellido',
  'Tipo_Evento_Plaga','Tipo_Plaga','Sector_Hallazgo','Comentario_Plaga'
];
const HDR_AROMA = [
  'Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento','Nombre','Apellido',
  'Dosif_inco_Aroma','Equip_malo_Aroma','Hurto_Equip_Aroma','Comentario_Aroma'
];
const HDR_QUIM = [
  'Response_ID','Timestamp','Tienda_ID','Tienda_Nombre','Fecha_Evento','Nombre','Apellido',
  'Falla_Dil_Quimico','Otra_Inci_Quimico','Problema_Ped_Quimico','Comentario_Quimicos'
];

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método no permitido" }, 405, req);
  }

  try {
    const body = await req.json();
    const oblig = ["Tienda_Nombre","Fecha_Evento","Nombre","Apellido","Tipo_Evento"];
    for (const k of oblig) {
      if (!String(body[k]||"").trim()) return json({ ok:false, error:`Falta ${k}` }, 400, req);
    }

    const env = readEnv();
    const token = await getAccessToken(env);
    const id = resolveSheetId(env.GOOGLE_SHEETS_ID);
    const SHEET_TND  = env.SHEET_TND  || "Tiendas";
    const SHEET_RESP = env.SHEET_RESP || "Respuestas";

    // Buscar Tienda_ID por nombre
    const tiendasRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${SHEET_TND}!A2:B`)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!tiendasRes.ok) throw new Error(`Tiendas error: ${await tiendasRes.text()}`);
    const tiendasJson = await tiendasRes.json();
    const target = normalize(body.Tienda_Nombre);
    let tiendaId = ""; let matches = 0;
    for (const r of (tiendasJson.values || [])) {
      const cc = String(r[0]||""); const nom = String(r[1]||"");
      if (normalize(nom) === target) { tiendaId = cc; matches++; }
    }
    let warn = "";
    if (matches === 0) warn = "No se encontró la tienda por nombre.";
    if (matches > 1)  warn = "Hay múltiples filas con el mismo Nombre_local.";

    const responseId = crypto.randomUUID();
    const tsISO = new Date().toISOString();

    const rowObj: Record<string, any> = {
      Response_ID: responseId,
      Timestamp: tsISO,
      Tienda_ID: tiendaId,
      Tienda_Nombre: body.Tienda_Nombre || '',
      Fecha_Evento: body.Fecha_Evento || '',
      Nombre: body.Nombre || '',
      Apellido: body.Apellido || '',
      Tipo_Evento: body.Tipo_Evento || '',
      // PLAGA
      Tipo_Evento_Plaga: body.Tipo_Evento_Plaga || '',
      Tipo_Plaga: body.Tipo_Plaga || '',
      Sector_Hallazgo: body.Sector_Hallazgo || '',
      Comentario_Plaga: body.Comentario_Plaga || '',
      // AROMA
      Dosif_inco_Aroma: body.Dosif_inco_Aroma || '',
      Equip_malo_Aroma: body.Equip_malo_Aroma || '',
      Hurto_Equip_Aroma: body.Hurto_Equip_Aroma || '',
      Comentario_Aroma: body.Comentario_Aroma || '',
      // QUÍMICO
      Falla_Dil_Quimico: body.Falla_Dil_Quimico || '',
      Otra_Inci_Quimico: body.Otra_Inci_Quimico || '',
      Problema_Ped_Quimico: body.Problema_Ped_Quimico || '',
      Comentario_Quimicos: body.Comentario_Quimico || '',
      Submitter_IP: ''
    };

    await appendValues(token, id, `${SHEET_RESP}!A:U`, [[...RESP_HEADERS.map(h => rowObj[h])]]);

    const tipo = String(body.Tipo_Evento || '');
    if (tipo === 'Plaga') {
      await appendValues(token, id, `Respuestas_Plaga!A:K`, [[...HDR_PLAGA.map(h => rowObj[h])]]);
    } else if (tipo === 'Aroma') {
      await appendValues(token, id, `Respuestas_Aroma!A:H`, [[...HDR_AROMA.map(h => rowObj[h])]]);
    } else if (tipo === 'Químico' || tipo === 'Quimico') {
      await appendValues(token, id, `Respuestas_Quimico!A:J`, [[...HDR_QUIM.map(h => rowObj[h])]]);
    }

    return json({ ok: true, Response_ID: responseId, Tienda_ID: tiendaId, warn }, 200, req);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Error interno" }, 500, req);
  }
}

async function appendValues(token: string, sheetId: string, range: string, values: any[][]) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values })
  });
  if (!r.ok) throw new Error(`Sheets append error: ${await r.text()}`);
}

