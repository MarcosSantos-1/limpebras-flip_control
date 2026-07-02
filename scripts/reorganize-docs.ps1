# Reorganiza docs/ para estrutura padronizada (kebab-case, pastas numeradas).
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$docs = Join-Path $root "docs"

function Ensure-Dir($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}

function Move-Doc {
  param([string]$From, [string]$To)
  $src = Join-Path $docs $From
  $dst = Join-Path $docs $To
  if (-not (Test-Path -LiteralPath $src)) { return }
  Ensure-Dir (Split-Path $dst -Parent)
  if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force }
  Move-Item -LiteralPath $src -Destination $dst -Force
}

# Pastas base
@(
  "01-projeto",
  "02-contrato",
  "03-flip/amostras",
  "04-ipt/dados/bateria",
  "04-ipt/dados/setores",
  "04-ipt/dados/modulos",
  "04-ipt/dados/cronograma",
  "04-ipt/dados/relatorios",
  "04-ipt/dados/trocas",
  "04-ipt/dados/planilhas",
  "05-infraestrutura",
  "06-referencia"
) | ForEach-Object { Ensure-Dir (Join-Path $docs $_) }

# --- Raiz docs -> pastas numeradas ---
Move-Doc "ADC.md" "02-contrato/adc-avaliacao-desempenho.md"
Move-Doc "BACKUP.md" "05-infraestrutura/backup-neon.md"
Move-Doc "firebase-storage-rules.md" "05-infraestrutura/firebase-storage-rules.md"
Move-Doc "flip.md" "03-flip/operacao.md"
Move-Doc "ESPECIFICACAO_DASHBOARD.md" "04-ipt/especificacao-dashboard-bateria.md"
Move-Doc "EXPLICAÇÃO IPT.MD" "04-ipt/explicacao.md"
Move-Doc "EXPLICAÇÃO IPT.pdf" "04-ipt/explicacao.pdf"
Move-Doc "IPT-DIAGNOSTICO.md" "04-ipt/diagnostico.md"
Move-Doc "IPT-DIAGNOSTICO-CONSERVADOR.md" "04-ipt/diagnostico-conservador.md"
Move-Doc "IPT-DECIFRAGEM-SELIMP.md" "04-ipt/decifracao-selimp.md"
Move-Doc "IPT-PLANO-OPERACIONAL-MAIO.md" "04-ipt/plano-operacional-maio.md"
Move-Doc "GLOSA.xlsx" "02-contrato/glosa.xlsx"
Move-Doc "VALORES MULTAS.xlsx" "02-contrato/multas-penalidades.xlsx"
Move-Doc "Cronogramas de Serviços Escalonados.xlsx" "02-contrato/cronogramas-servicos-escalonados.xlsx"
Move-Doc "Cronogramas de Serviços Fixos.xlsx" "02-contrato/cronogramas-servicos-fixos.xlsx"
Move-Doc "geoportal_subprefeitura_v2.geojson" "06-referencia/geoportal-subprefeitura-v2.geojson"

# Amostras FLIP
Get-ChildItem -LiteralPath $docs -Filter "FLIP_CONSULTA_*.csv" -File -ErrorAction SilentlyContinue | ForEach-Object {
  $newName = switch -Regex ($_.Name) {
    "FLIP_CONSULTA_ACIC_1122026" { "consulta-acic-2026-01-12.csv"; break }
    "FLIP_CONSULTA_BFS_1122026" { "consulta-bfs-2026-01-12.csv"; break }
    "FLIP_CONSULTA_CNC_332026" { "consulta-cnc-2026-03-03.csv"; break }
    "FLIP_CONSULTA_OUVIDORIA_1122026" { "consulta-ouvidoria-2026-01-12.csv"; break }
    "FLIP_CONSULTA_SAC_1122026" { "consulta-sac-2026-01-12.csv"; break }
    default { $_.Name.ToLower() }
  }
  Move-Item -LiteralPath $_.FullName -Destination (Join-Path $docs "03-flip/amostras/$newName") -Force
}

# --- ipt/ legado ---
Move-Doc "ipt/frequencias.md" "04-ipt/frequencias-codigos.md"
Move-Doc "ipt/trocas_historico_transformado.csv" "04-ipt/dados/trocas/trocas-historico-transformado.csv"
Move-Doc "ipt/trocas_historico_ambiguas.csv" "04-ipt/dados/trocas/trocas-historico-ambiguas.csv"
Move-Doc "ipt/TROCAS_DE_MODULOS.xlsx" "04-ipt/dados/modulos/trocas-de-modulos.xlsx"
Move-Doc "ipt/baterias x modulos.xlsx" "04-ipt/dados/bateria/baterias-x-modulos.xlsx"
Move-Doc "ipt/Status de Bateria.xlsx" "04-ipt/dados/bateria/status-bateria.xlsx"
Move-Doc "ipt/HISTÓRICO GERAL BATERIA VARRICAO.xlsx" "04-ipt/dados/bateria/historico-geral-varricao.xlsx"
Move-Doc "ipt/Histórico de operações.xlsx" "04-ipt/dados/bateria/historico-operacoes.xlsx"
Move-Doc "ipt/MÓDULOS - SELIMP X LIMPEBRA(análise completa)).xlsx" "04-ipt/dados/modulos/modulos-selimp-limpebras-analise.xlsx"
Move-Doc "ipt/SETORES.xlsx" "04-ipt/dados/setores/setores.xlsx"
Move-Doc "ipt/SETORES (21.05.2026).xlsx" "04-ipt/dados/setores/setores-2026-05-21.xlsx"
Move-Doc "ipt/historico_os.xlsx" "04-ipt/dados/planilhas/historico-os.xlsx"
Move-Doc "ipt/historico_os (1).xlsx" "04-ipt/dados/planilhas/historico-os-copia.xlsx"
Move-Doc "ipt/Planilha 13.05.xlsx" "04-ipt/dados/planilhas/planilha-2026-05-13.xlsx"
Move-Doc "ipt/report.xlsx" "04-ipt/dados/planilhas/report.xlsx"
Move-Doc "ipt/report(atualizada).xlsx" "04-ipt/dados/planilhas/report-atualizada.xlsx"
Move-Doc "ipt/relatorio-20260330-1437.xls" "04-ipt/dados/relatorios/relatorio-2026-03-30-1437.xls"
Move-Doc "ipt/relatorio-20260330-1533.xls" "04-ipt/dados/relatorios/relatorio-2026-03-30-1533.xls"

# Cronograma por sub
Get-ChildItem -LiteralPath (Join-Path $docs "ipt/cronograma") -Filter "*.xlsx" -File -ErrorAction SilentlyContinue | ForEach-Object {
  $dest = Join-Path $docs ("04-ipt/dados/cronograma/" + $_.BaseName.ToLower() + $_.Extension.ToLower())
  Move-Item -LiteralPath $_.FullName -Destination $dest -Force
}

# Duplicata de especificação
$dupSpec = Join-Path $docs "ipt/ESPECIFICACAO_DASHBOARD.md"
if (Test-Path -LiteralPath $dupSpec) { Remove-Item -LiteralPath $dupSpec -Force }

# Lixo / temporários
Get-ChildItem -LiteralPath $docs -Recurse -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq ".DS_Store" -or $_.Name -like ".~*" -or $_.Name -like "~$*" } |
  Remove-Item -Force -Recurse -ErrorAction SilentlyContinue

# Pasta image/frequencias (artefatos de editor)
$imgFreq = Join-Path $docs "ipt/image"
if (Test-Path -LiteralPath $imgFreq) { Remove-Item -LiteralPath $imgFreq -Recurse -Force }

# Remover pastas vazias legadas
@("ipt/cronograma", "ipt") | ForEach-Object {
  $p = Join-Path $docs $_
  if ((Test-Path -LiteralPath $p) -and -not (Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Reorganizacao de docs/ concluida."
