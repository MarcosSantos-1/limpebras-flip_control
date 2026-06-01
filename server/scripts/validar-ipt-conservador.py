#!/usr/bin/env python3
"""
Valida o IPT Conservador contra a apuração SELIMP para meses conhecidos.

Reproduz LOCALMENTE (Python puro, sem TS) todas as 7 variantes do serviço
server/src/services/ipt-conservador.ts e compara contra os valores oficiais:

  Fev 2026:  97,60%
  Mar 2026:  98,00%
  Abr 2026:  65,30%

Conexão: lê DATABASE_URL do server/.env (ou da variável de ambiente).

Uso:
    cd server
    python3 scripts/validar-ipt-conservador.py             # roda fev/mar/abr 2026
    python3 scripts/validar-ipt-conservador.py --ano 2026 --mes 4
    python3 scripts/validar-ipt-conservador.py --inicio 2026-04-01 --fim 2026-04-30
    python3 scripts/validar-ipt-conservador.py --csv saida.csv   # exporta calibração

Dependências:
    pip install psycopg2-binary
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import statistics
import sys
from calendar import monthrange
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERRO: instale psycopg2-binary -> pip install psycopg2-binary", file=sys.stderr)
    sys.exit(2)


# ------------------------------------------------------------------- helpers


def load_dsn() -> str:
    """Lê DATABASE_URL de server/.env ou variável de ambiente."""
    env = os.environ.get("DATABASE_URL")
    if env:
        return env
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    print("ERRO: DATABASE_URL nao encontrado (server/.env ou env var).", file=sys.stderr)
    sys.exit(2)


def normalize_setor(s: str) -> str:
    """Espelha normalizarSetor de constants/ipt.ts (apaga espaços + UPPER)."""
    return re.sub(r"\s+", "", str(s or "")).strip().upper()


def normalize_match(s: str) -> str:
    return (
        str(s or "")
        .strip()
        .lower()
    )


def percent_display_to_decimal(s: float) -> float:
    """Replica percentDisplayToDecimal: aceita 97 ou 0.97 e devolve 0..1."""
    if s is None:
        return 0.0
    if s > 1:
        return min(1.0, max(0.0, s / 100.0))
    return min(1.0, max(0.0, s))


@dataclass
class Linha:
    plano: str
    percentual: float  # 0..1
    subprefeitura: str = ""
    servico: str = ""


# ------------------------------------------------------------------- fetch


def fetch_linhas(cur, inicio: str, fim: str) -> tuple[list[Linha], str]:
    """Carrega linhas no mesmo formato do TS (consolidado > fallback report)."""
    cur.execute(
        """SELECT setor, raw FROM ipt_imports
           WHERE file_type IN ('ipt_consolidado_veiculos','ipt_consolidado_varricao')
             AND data_referencia >= %s::date AND data_referencia <= %s::date""",
        (inicio, fim),
    )
    rows = cur.fetchall()
    if rows:
        out: list[Linha] = []
        for row in rows:
            plano = normalize_setor(row["setor"] or "")
            if not plano:
                continue
            raw = row["raw"] or {}
            s = raw.get("percentual_selimp")
            try:
                s = float(s)
            except (TypeError, ValueError):
                continue
            pct = percent_display_to_decimal(s if s <= 1 else s)
            out.append(Linha(
                plano=plano,
                percentual=pct,
                subprefeitura=str(raw.get("subprefeitura") or "").strip(),
                servico=str(raw.get("servico") or "").strip(),
            ))
        if out:
            return out, "consolidado_selimp"

    cur.execute(
        """SELECT plano, percentual_execucao, status, subprefeitura, tipo_servico
           FROM ipt_report_linhas
           WHERE data_estimada >= %s::date AND data_estimada <= %s::date""",
        (inicio, fim),
    )
    out = []
    for row in cur.fetchall():
        if "encerrado" not in normalize_match(row["status"] or ""):
            continue
        plano = normalize_setor(row["plano"] or "")
        if not plano:
            continue
        try:
            raw_pct = float(row["percentual_execucao"])
        except (TypeError, ValueError):
            continue
        pct = raw_pct / 100.0 if raw_pct > 1 else raw_pct
        pct = min(1.0, max(0.0, pct))
        out.append(Linha(
            plano=plano,
            percentual=pct,
            subprefeitura=str(row["subprefeitura"] or "").strip(),
            servico=str(row["tipo_servico"] or "").strip(),
        ))
    return out, "report_selimp_encerrado"


# ------------------------------------------------------------------- variantes (espelha o TS)


def media(xs: Iterable[float]) -> float:
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def desvio_padrao(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    return statistics.stdev(xs)


def variantes(linhas: list[Linha]) -> dict[str, float | None]:
    """Calcula todas as variantes, devolvendo percentuais em 0..100."""
    if not linhas:
        return {f"v{i}": None for i in range(1, 8)}

    por_plano: dict[str, list[float]] = {}
    for l in linhas:
        por_plano.setdefault(l.plano, []).append(l.percentual)

    medias_planos = [media(v) for v in por_plano.values()]
    medianas_planos = [statistics.median(v) for v in por_plano.values()]
    blends_planos = [0.48 * max(v) + 0.52 * media(v) for v in por_plano.values()]

    def pct(x: float) -> float:
        return round(min(1.0, max(0.0, x)) * 100, 2)

    # V1 — espelho do cálculo atual em produção
    blends_nao_zero = [v for v in blends_planos if v > 0]
    Qb1 = media(blends_nao_zero)
    s1 = desvio_padrao(blends_nao_zero)
    q1 = min(Qb1 + min(s1, 0.08), 1.0)
    v1 = 0.7 * q1 + 0.3 * 1.0

    # V2 — PF com zeros dentro do Q̄
    Qb2 = media(blends_planos)
    s2 = desvio_padrao(blends_planos)
    q2 = min(Qb2 + min(s2, 0.08), 1.0)
    v2 = 0.7 * q2 + 0.3 * 1.0

    # V3 — média por plano com zeros
    v3 = media(medias_planos)

    # V4 — média linha-a-linha com zeros
    v4 = media([l.percentual for l in linhas])

    # V5 — mediana por plano
    v5 = media(medianas_planos)

    # V6 — PF com cobertura proxy
    planos_exec = sum(1 for arr in por_plano.values() if any(v > 0 for v in arr))
    cob = planos_exec / len(por_plano) if por_plano else 0.0
    Qb6 = media(blends_planos)
    s6 = desvio_padrao(blends_planos)
    q6 = min(Qb6 + min(s6, 0.08), 1.0)
    v6 = 0.7 * q6 + 0.3 * cob

    # V7 — combinação 0.6·V3 + 0.4·V4 (mantida para histórico)
    v7 = 0.6 * v3 + 0.4 * v4

    # V8 — Q̄sem_zeros × cobertura_planos (proxy SELIMP recomendado)
    nao_zero_linhas = [l.percentual for l in linhas if l.percentual > 0]
    qb_sem_zeros = media(nao_zero_linhas)
    v8 = qb_sem_zeros * cob

    return {
        "v1_oficial_atual": pct(v1),
        "v2_pf_zeros_dentro": pct(v2),
        "v3_media_planos_com_zeros": pct(v3),
        "v4_media_linhas_com_zeros": pct(v4),
        "v5_mediana_planos": pct(v5),
        "v6_pf_cobertura_proxy": pct(v6),
        "v7_combinado_calibrado": pct(v7),
        "v8_execucao_x_cobertura": pct(v8),
    }


def diagnostico(linhas: list[Linha]) -> dict[str, float | int]:
    if not linhas:
        return {}
    por_plano: dict[str, list[float]] = {}
    for l in linhas:
        por_plano.setdefault(l.plano, []).append(l.percentual)
    zeradas = sum(1 for l in linhas if l.percentual <= 0)
    planos_zerados = sum(1 for arr in por_plano.values() if all(v <= 0 for v in arr))
    return {
        "linhas": len(linhas),
        "linhas_zeradas": zeradas,
        "pct_zeradas": round(100 * zeradas / len(linhas), 2),
        "planos": len(por_plano),
        "planos_zerados": planos_zerados,
        "pct_planos_zerados": round(100 * planos_zerados / len(por_plano), 2) if por_plano else 0,
        "media_com_zeros": round(100 * media([l.percentual for l in linhas]), 2),
        "media_sem_zeros": round(
            100 * media([l.percentual for l in linhas if l.percentual > 0]) if any(l.percentual > 0 for l in linhas) else 0, 2
        ),
    }


# ------------------------------------------------------------------- relatório


SELIMP_OFICIAIS = {
    "2026-02": 97.60,
    "2026-03": 98.00,
    "2026-04": 65.30,
}


def rodar_mes(cur, ano: int, mes: int, oficial: float | None) -> dict:
    inicio = f"{ano:04d}-{mes:02d}-01"
    fim = f"{ano:04d}-{mes:02d}-{monthrange(ano, mes)[1]:02d}"
    linhas, fonte = fetch_linhas(cur, inicio, fim)
    var = variantes(linhas)
    diag = diagnostico(linhas)
    return {
        "periodo": f"{inicio} a {fim}",
        "fonte": fonte,
        "oficial_selimp": oficial,
        "variantes": var,
        "diagnostico": diag,
    }


def fmt_pct(v: float | None) -> str:
    return f"{v:.2f}" if v is not None else "—"


def imprimir(reports: list[dict]) -> None:
    # Cabeçalho
    print("\n" + "=" * 92)
    print("IPT Conservador — Validação contra apuração SELIMP")
    print("=" * 92)

    for r in reports:
        v = r["variantes"]
        d = r["diagnostico"]
        oficial = r["oficial_selimp"]
        print(f"\n— Período {r['periodo']} (fonte: {r['fonte']})")
        print(f"  Diagnóstico: {d.get('linhas', 0)} linhas | {d.get('planos', 0)} planos | "
              f"{d.get('pct_zeradas', 0)}% linhas zeradas | {d.get('pct_planos_zerados', 0)}% planos zerados")
        print(f"  Médias gerais: com zeros={fmt_pct(d.get('media_com_zeros'))}%  |  sem zeros={fmt_pct(d.get('media_sem_zeros'))}%")
        print()
        print(f"  {'Variante':<35} {'Valor':>10}   {'Erro vs SELIMP':>15}")
        print(f"  {'-'*35} {'-'*10}   {'-'*15}")
        for vid, val in v.items():
            erro = (val - oficial) if (val is not None and oficial is not None) else None
            erro_txt = f"{erro:+.2f}" if erro is not None else "—"
            print(f"  {vid:<35} {fmt_pct(val):>10}   {erro_txt:>15}")
        if oficial is not None:
            print(f"  {'(SELIMP oficial)':<35} {oficial:>10.2f}   {'0.00':>15}")

    # Calibração: qual variante teve MAE mínima nos meses com oficial conhecido
    print("\n" + "-" * 92)
    print("Calibração: MAE (erro absoluto médio) por variante nos meses com SELIMP oficial")
    print("-" * 92)
    erros: dict[str, list[float]] = {}
    for r in reports:
        if r["oficial_selimp"] is None:
            continue
        for vid, val in r["variantes"].items():
            if val is None:
                continue
            erros.setdefault(vid, []).append(abs(val - r["oficial_selimp"]))
    ranking = sorted(
        [(vid, sum(es) / len(es), max(es)) for vid, es in erros.items()],
        key=lambda x: x[1],
    )
    print(f"  {'Variante':<35} {'MAE':>8} {'pior mes':>10}")
    print(f"  {'-'*35} {'-'*8} {'-'*10}")
    for vid, mae, pior in ranking:
        marker = "  ← melhor" if vid == ranking[0][0] else ""
        print(f"  {vid:<35} {mae:>8.2f} {pior:>10.2f}{marker}")
    print()


def export_csv(reports: list[dict], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["periodo", "fonte", "variante", "valor_pct", "selimp_oficial", "erro_pp"])
        for r in reports:
            for vid, val in r["variantes"].items():
                erro = (val - r["oficial_selimp"]) if (val is not None and r["oficial_selimp"] is not None) else None
                w.writerow([
                    r["periodo"], r["fonte"], vid,
                    f"{val:.2f}" if val is not None else "",
                    f"{r['oficial_selimp']:.2f}" if r["oficial_selimp"] is not None else "",
                    f"{erro:.2f}" if erro is not None else "",
                ])
    print(f"CSV salvo em {path}")


# ------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description="Valida IPT conservador contra SELIMP.")
    ap.add_argument("--inicio")
    ap.add_argument("--fim")
    ap.add_argument("--ano", type=int)
    ap.add_argument("--mes", type=int)
    ap.add_argument("--csv", help="Exporta resultados em CSV")
    args = ap.parse_args()

    dsn = load_dsn()
    conn = psycopg2.connect(dsn)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    reports: list[dict] = []
    if args.inicio and args.fim:
        # Período custom — sem oficial conhecido
        ano = int(args.inicio[:4])
        mes = int(args.inicio[5:7])
        oficial = SELIMP_OFICIAIS.get(f"{ano:04d}-{mes:02d}") if args.inicio.endswith("-01") else None
        linhas, fonte = fetch_linhas(cur, args.inicio, args.fim)
        reports.append({
            "periodo": f"{args.inicio} a {args.fim}",
            "fonte": fonte,
            "oficial_selimp": oficial,
            "variantes": variantes(linhas),
            "diagnostico": diagnostico(linhas),
        })
    elif args.ano and args.mes:
        chave = f"{args.ano:04d}-{args.mes:02d}"
        reports.append(rodar_mes(cur, args.ano, args.mes, SELIMP_OFICIAIS.get(chave)))
    else:
        # Default: fev/mar/abr 2026
        for chave, oficial in SELIMP_OFICIAIS.items():
            ano, mes = map(int, chave.split("-"))
            reports.append(rodar_mes(cur, ano, mes, oficial))

    imprimir(reports)
    if args.csv:
        export_csv(reports, args.csv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
