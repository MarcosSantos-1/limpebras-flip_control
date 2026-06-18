/**
 * Reimporta o histórico de trocas a partir de docs/ipt/TROCAS_DE_MODULOS.xlsx
 * resolvendo setor -> SELIMP pelo crosswalk do banco (setores_modulos).
 *
 *   node scripts/reimport-trocas-from-xlsx.mjs            # DRY-RUN (não grava)
 *   node scripts/reimport-trocas-from-xlsx.mjs --execute  # backup + REPLACE no Neon
 */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import pg from "pg"; import * as XLSX from "../../web/node_modules/xlsx/xlsx.mjs";
const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXECUTE = process.argv.includes("--execute");
const XLSXF = path.join(__dirname, "../../docs/ipt/TROCAS_DE_MODULOS.xlsx");
// Janela de gravação: só grava trocas com data_troca neste intervalo (inclusive).
const WIN_INI = "2026-06-10";
const WIN_FIM = "2026-06-17";

function dbUrl(){ return fs.readFileSync(path.join(__dirname,"../.env"),"utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length).trim(); }
const pad2 = (n)=>String(n).padStart(2,"0");
function parseDate(v){
  if (v==null || v==="") return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth()+1)}-${pad2(v.getDate())}`;
  const s=String(v).trim();
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){ let[_,mm,dd,yy]=m; yy=yy.length<=2?2000+Number(yy):Number(yy); return `${yy}-${pad2(Number(mm))}-${pad2(Number(dd))}`; }
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  return null;
}
function parsePct(v){ if(v==null||v==="")return null; const n=parseFloat(String(v).replace(/[^0-9.,-]/g,"").replace(",",".")); return Number.isFinite(n)?n:null; }

async function main(){
  const wb = XLSX.read(fs.readFileSync(XLSXF), { type:"buffer", cellDates:true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:"" });
  // header: DATA, MOTIVO DA TROCA, SETORES CV, SETORES JT, SETORES MG, SETORES ST, SINAL, BATERIA, STATUS
  const data = raw.slice(1).filter(r => String(r[0]).trim() || String(r[2]).trim() || String(r[3]).trim() || String(r[4]).trim() || String(r[5]).trim());

  const pool = new Pool({ connectionString:dbUrl(), ssl:{rejectUnauthorized:false} });
  const c = await pool.connect();
  try {
    const cw = new Map();
    for (const r of (await c.query("SELECT setor, selimp_codigo FROM setores_modulos WHERE selimp_codigo IS NOT NULL")).rows)
      cw.set(String(r.setor).trim().toUpperCase(), r.selimp_codigo);

    // Expande "CV10202VP0013/14/15" nos setores componentes (base + sufixos) e resolve p/ SELIMP.
    function expandSetor(s){
      const first = s.split(/\s+/)[0].toUpperCase();           // remove ruído tipo " VL"
      const parts = first.split("/");
      const base = parts[0];
      const m = base.match(/^(.*?)(\d+)$/);
      if(!m || parts.length===1) return [base];
      const prefix = m[1], width = m[2].length;
      const out = [base];
      for(const suf of parts.slice(1)){
        const d = suf.replace(/\D/g,""); if(!d) continue;
        out.push(prefix + d.padStart(width,"0"));
      }
      return out;
    }
    function resolve(s){
      const sels = [...new Set(expandSetor(s).map(cmp=>cw.get(cmp)).filter(Boolean))];
      if(sels.length===1) return { sel: sels[0] };
      if(sels.length>1) return { ambiguous: sels };
      return { unmatched: true };
    }

    const events=[]; const unmatched=[]; const ambiguous=[]; const motivo={}; const status={};
    data.forEach((r, idx)=>{
      const source_row = idx+2;
      const data_troca = parseDate(r[0]);
      const tipo = String(r[1]).trim().toUpperCase();
      const setor = [r[2],r[3],r[4],r[5]].map(x=>String(x).trim()).find(Boolean) || "";
      const sinal = parseDate(r[6]);
      const bateria_raw = String(r[7]).trim();
      const st = String(r[8]).trim().toUpperCase();
      motivo[tipo]=(motivo[tipo]||0)+1; status[st]=(status[st]||0)+1;
      if(!setor){ unmatched.push({source_row,reason:"sem setor"}); return; }
      const res = resolve(setor);
      if(res.ambiguous){ ambiguous.push({source_row,setor,data_troca,modulos:res.ambiguous}); return; }
      if(res.unmatched){ unmatched.push({source_row,setor,data_troca}); return; }
      events.push({ source_row, modulo_selimp:res.sel, setor, tipo_troca:tipo,
        sucesso: st==="ATUALIZADA", data_troca, ultima_comunicacao:sinal,
        bateria_antes_raw: bateria_raw||null, bateria_antes_percentual: parsePct(bateria_raw) });
    });

    const inWin = (d)=> d && d>=WIN_INI && d<=WIN_FIM;
    const win = events.filter(e=>inWin(e.data_troca));
    const dates = events.map(e=>e.data_troca).filter(Boolean).sort();
    const qtd = new Map(); for(const e of events) qtd.set(e.modulo_selimp,(qtd.get(e.modulo_selimp)||0)+1);
    console.log("=== DRY-RUN reimport TROCAS_DE_MODULOS.xlsx ===");
    console.log("linhas de dados (não vazias):", data.length);
    console.log("eventos resolvidos (total):", events.length, "| módulos distintos:", qtd.size);
    console.log("ambíguos (setor '/' em 2+ módulos, excluídos):", ambiguous.length);
    console.log("não resolvidos:", unmatched.length);
    console.log("intervalo data_troca (total):", dates[0], "→", dates[dates.length-1]);
    console.log("MOTIVO:", motivo, "| STATUS:", status);
    if(ambiguous.length) console.log("amostra ambíguos:", ambiguous.slice(0,6).map(a=>`${a.setor} (${a.data_troca}) -> ${a.modulos.join("+")}`));
    if(unmatched.length) console.log("não resolvidos:", unmatched.map(u=>u.setor?`${u.source_row}:${u.setor} (${u.data_troca})`:`${u.source_row}:${u.reason}`));
    console.log(`\n=== JANELA ${WIN_INI}..${WIN_FIM} (o que SERIA gravado) ===`);
    const winQtd = new Map(); for(const e of win) winQtd.set(e.modulo_selimp,(winQtd.get(e.modulo_selimp)||0)+1);
    console.log("eventos na janela:", win.length, "| módulos distintos:", winQtd.size);
    console.log("MOTIVO janela:", win.reduce((a,e)=>((a[e.tipo_troca]=(a[e.tipo_troca]||0)+1),a),{}));
    console.log("sucesso=true:", win.filter(e=>e.sucesso).length, "| false:", win.filter(e=>!e.sucesso).length);
    console.log("por dia:", win.reduce((a,e)=>((a[e.data_troca]=(a[e.data_troca]||0)+1),a),{}));
    console.log("amostra (10):", win.slice(0,10).map(e=>`${e.data_troca} ${e.setor}->${e.modulo_selimp} ${e.tipo_troca} ${e.sucesso?"OK":"FALHA"}`));
    if(!EXECUTE){ console.log("\n(DRY-RUN — nada gravado.)"); return; }
    if(win.length===0){ console.log("\nNada na janela para gravar."); return; }

    // ---- BACKUP (CSV) das tabelas afetadas, antes de qualquer escrita ----
    const stamp = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
    const bdir = path.join(__dirname, "backups"); fs.mkdirSync(bdir, { recursive:true });
    const toCsv = (rows)=>{ if(!rows.length) return ""; const h=Object.keys(rows[0]);
      const esc=(v)=> v==null?"":/[",\n]/.test(String(v))?`"${String(v).replace(/"/g,'""')}"`:String(v);
      return [h.join(","), ...rows.map(r=>h.map(k=>esc(r[k])).join(","))].join("\n"); };
    for(const t of ["bateria_trocas_eventos","bateria_trocas"]){
      const rows = (await c.query(`SELECT * FROM ${t}`)).rows;
      fs.writeFileSync(path.join(bdir,`${t}_${stamp}.csv`), toCsv(rows));
      console.log(`backup: ${t} -> ${rows.length} linhas`);
    }
    const qtdRows = (await c.query("SELECT modulo_selimp, qtd_trocas FROM modulo_selimp")).rows;
    fs.writeFileSync(path.join(bdir,`modulo_selimp_qtd_${stamp}.csv`), toCsv(qtdRows));
    console.log(`backup: modulo_selimp.qtd_trocas -> ${qtdRows.length} linhas (em scripts/backups/)`);

    // ---- TRANSAÇÃO: substitui só a janela ----
    await c.query("BEGIN");
    const affected = new Set(win.map(e=>e.modulo_selimp));
    // módulos dos eventos que serão removidos (para recálculo de estado)
    for(const r of (await c.query(
      `SELECT DISTINCT modulo_selimp FROM bateria_trocas_eventos
        WHERE (status='concluida' AND data_troca BETWEEN $1 AND $2) OR status='agendada'`, [WIN_INI,WIN_FIM])).rows)
      affected.add(r.modulo_selimp);

    const delConcl = await c.query(`DELETE FROM bateria_trocas_eventos WHERE status='concluida' AND data_troca BETWEEN $1 AND $2`, [WIN_INI,WIN_FIM]);
    const delAgen  = await c.query(`DELETE FROM bateria_trocas_eventos WHERE status='agendada'`);
    console.log(`removidos: ${delConcl.rowCount} concluída(s) na janela + ${delAgen.rowCount} agendada(s)`);

    // insere os 140 (lotes)
    const CHUNK=200; let ins=0;
    for(let i=0;i<win.length;i+=CHUNK){
      const ch=win.slice(i,i+CHUNK); const vals=[]; const params=[];
      ch.forEach((e,j)=>{ const b=j*8;
        vals.push(`($${b+1},$${b+2},'concluida',$${b+3},$${b+4},$${b+5}::date,$${b+6}::date,$${b+7},$${b+8})`);
        params.push(e.modulo_selimp, e.setor||null, e.tipo_troca||null, e.sucesso, e.data_troca, e.ultima_comunicacao, e.bateria_antes_raw, e.bateria_antes_percentual);
      });
      await c.query(`INSERT INTO bateria_trocas_eventos
        (modulo_selimp, setor, status, tipo_troca, sucesso, data_troca, ultima_comunicacao, bateria_antes_raw, bateria_antes_percentual)
        VALUES ${vals.join(",")}`, params);
      ins+=ch.length;
    }
    console.log(`inseridos: ${ins} eventos na janela`);

    // recalcula qtd_trocas e estado-corrente só dos módulos afetados
    let recq=0, recs=0, delcur=0;
    for(const sel of affected){
      await c.query(`UPDATE modulo_selimp SET qtd_trocas=(SELECT count(*) FROM bateria_trocas_eventos WHERE modulo_selimp=$1 AND status='concluida'), updated_at=NOW() WHERE modulo_selimp=$1`, [sel]); recq++;
      const lt = (await c.query(`SELECT setor, sucesso, data_troca::text dt, ultima_comunicacao::text uc
        FROM bateria_trocas_eventos WHERE modulo_selimp=$1 AND status='concluida'
        ORDER BY data_troca DESC NULLS LAST, id DESC LIMIT 1`, [sel])).rows[0];
      if(lt){
        await c.query(`INSERT INTO bateria_trocas (modulo_selimp, setor, status, sucesso, data_troca, ultima_comunicacao, updated_at)
          VALUES ($1,$2,'concluida',$3,$4::date,$5::date,NOW())
          ON CONFLICT (modulo_selimp) DO UPDATE SET
            setor=COALESCE(EXCLUDED.setor,bateria_trocas.setor), status='concluida', sucesso=EXCLUDED.sucesso,
            data_troca=EXCLUDED.data_troca, ultima_comunicacao=EXCLUDED.ultima_comunicacao, updated_at=NOW()`,
          [sel, lt.setor||null, lt.sucesso, lt.dt, lt.uc]); recs++;
      } else {
        const d=await c.query(`DELETE FROM bateria_trocas WHERE modulo_selimp=$1`, [sel]); delcur+=d.rowCount;
      }
    }
    console.log(`recalculado: qtd_trocas em ${recq} módulos | estado-corrente upsert ${recs} / removido ${delcur}`);

    await c.query("COMMIT");
    // verificação pós-commit
    const after = async s => (await c.query(s)).rows[0];
    console.log("\n✅ COMMIT. Verificação:");
    console.log("  eventos na janela agora:", (await after(`SELECT count(*)::int n FROM bateria_trocas_eventos WHERE data_troca BETWEEN '${WIN_INI}' AND '${WIN_FIM}'`)).n);
    console.log("  eventos totais:", (await after("SELECT count(*)::int n FROM bateria_trocas_eventos")).n);
    console.log("  agendadas restantes:", (await after("SELECT count(*)::int n FROM bateria_trocas_eventos WHERE status='agendada'")).n);
    console.log("  qtd_trocas total:", (await after("SELECT sum(qtd_trocas)::int n FROM modulo_selimp")).n);
  } catch(err){ await c.query("ROLLBACK").catch(()=>{}); console.error("\n⛔ ROLLBACK:", err.message); process.exitCode=1;
  } finally { c.release(); await pool.end(); }
}
main();
