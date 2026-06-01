# ESPECIFICACAO TECNICA - DASHBOARD DE MONITORAMENTO DE MODULOS

## VISAO GERAL DA ESTRUTURA

```
/page.tsx (ou /dashboard/page.tsx)
  |-- Header (sticky top)
  |-- Main (container)
  |     |-- Tabs
  |     |     |-- TabsList (4 abas)
  |     |     |-- TabsContent "overview"
  |     |     |     |-- KPICards (grid 6 colunas)
  |     |     |     |-- Charts (grid 4 colunas)
  |     |     |-- TabsContent "modules"
  |     |     |     |-- ModulesTable
  |     |     |-- TabsContent "alerts"
  |     |     |     |-- AlertsPanel
  |     |     |-- TabsContent "dispatch"
  |     |           |-- DispatchForm
  |-- Footer
```

---

## 1. PALETA DE CORES (CSS Variables)

```css
/* Tema Dark - Aplicar no globals.css ou tema */
:root {
  /* Background/Cards */
  --background: #0f1419;           /* oklch(0.12 0.005 260) - Fundo principal */
  --card: #161d24;                 /* oklch(0.16 0.005 260) - Cards */
  --secondary: #1e2730;            /* oklch(0.22 0.005 260) - Secundario */
  
  /* Textos */
  --foreground: #f0f0f0;           /* oklch(0.95 0 0) - Texto principal */
  --muted-foreground: #9ca3af;     /* oklch(0.65 0 0) - Texto secundario */
  
  /* Bordas */
  --border: #2d3748;               /* oklch(0.28 0.005 260) */
  
  /* Cores de Status */
  --status-success: #22c55e;       /* Verde - Online, Cheia, Com Sinal */
  --status-warning: #eab308;       /* Amarelo - Baixa, Pendente */
  --status-error: #ef4444;         /* Vermelho - Offline, Desatualizada, Critico */
  --status-info: #3b82f6;          /* Azul - Operacional, Em Andamento */
  
  /* Cor Primaria (Accent) */
  --primary: #10b981;              /* Verde Esmeralda - Botoes, Destaques */
}
```

---

## 2. ICONES UTILIZADOS (Lucide React)

```bash
npm install lucide-react
```

### Por Componente:

**Header:**
- `Activity` - Logo/icone principal
- `Calendar` - Data de atualizacao (remover se nao usar header completo)

**KPI Cards:**
- `Activity` - Total de Modulos
- `Wifi` - Online (cor: status-success)
- `WifiOff` - Offline (cor: status-error)
- `TrendingUp` - Produtividade Media (cor: primary)
- `AlertTriangle` - Alertas Criticos (cor: status-error)
- `Battery` - Bateria Baixa (cor: status-warning)

**Tabs:**
- `LayoutDashboard` - Visao Geral
- `Table2` - Modulos
- `AlertTriangle` - Alertas
- `FileText` - Despachos

**Tabela de Modulos:**
- `Search` - Campo de busca
- `Filter` - Filtro de subprefeitura
- `Download` - Exportar CSV
- `MoreHorizontal` - Menu de acoes (3 pontinhos)
- `Eye` - Ver Detalhes
- `FileText` - Gerar Despacho
- `ChevronLeft` / `ChevronRight` - Paginacao

**Painel de Alertas:**
- `AlertTriangle` - Icone de alerta geral
- `WifiOff` - Alerta offline
- `Battery` - Alerta bateria
- `Clock` - Ultima comunicacao
- `ArrowRight` - Acao

**Formulario de Despachos:**
- `FileText` - Titulo
- `Plus` - Novo Despacho
- `Calendar` - Data
- `Clock` - Hora
- `CheckCircle2` - Concluido
- `AlertCircle` - Pendente/Critico

---

## 3. COMPONENTES SHADCN/UI UTILIZADOS

```bash
npx shadcn@latest add card badge button input tabs select dropdown-menu dialog textarea table scroll-area
```

Lista completa:
- `Card`, `CardContent`, `CardHeader`, `CardTitle`, `CardDescription`
- `Badge`
- `Button`
- `Input`
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`
- `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`
- `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuTrigger`
- `Dialog`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogTitle`, `DialogTrigger`
- `Textarea`
- `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow`
- `ScrollArea`

---

## 4. BIBLIOTECA DE GRAFICOS

```bash
npm install recharts
```

Componentes usados:
- `BarChart`, `Bar` (grafico de barras)
- `PieChart`, `Pie` (grafico de pizza/donut)
- `Cell` (celulas coloridas)
- `ResponsiveContainer`
- `XAxis`, `YAxis`
- `Tooltip`, `Legend`

---

## 5. ESTRUTURA DE CADA COMPONENTE

### 5.1 KPI CARDS

**Layout:** `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4`

**Cada Card:**
```
Card (border-border/50 bg-card/50 backdrop-blur-sm)
  |-- CardHeader (flex flex-row items-center justify-between pb-2)
  |     |-- CardTitle (text-sm font-medium text-muted-foreground)
  |     |-- Icone (h-4 w-4 text-[COR-DO-STATUS])
  |-- CardContent
        |-- div (text-2xl font-bold text-[COR-DO-STATUS])  <- Valor
        |-- p (text-xs text-muted-foreground)              <- Descricao
```

**6 Cards:**
| # | Titulo | Icone | Cor do Valor | Descricao |
|---|--------|-------|--------------|-----------|
| 1 | Total de Modulos | Activity | foreground | "Dispositivos monitorados" |
| 2 | Online | Wifi | status-success | "XX% operacionais" |
| 3 | Offline | WifiOff | status-error | "Sem comunicacao" |
| 4 | Produtividade Media | TrendingUp | primary | "Dias ON / Total" |
| 5 | Alertas Criticos | AlertTriangle | status-error | "Requerem atencao" |
| 6 | Bateria Baixa | Battery | status-warning | "Necessitam troca" |

---

### 5.2 GRAFICOS (4 graficos em grid)

**Layout:** `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`

**Grafico 1 e 2:** `col-span-2` (ocupam 2 colunas)
**Grafico 3 e 4:** `col-span-2` (ocupam 2 colunas)

**Cada Card de Grafico:**
```
Card (col-span-2 border-border/50 bg-card/50 backdrop-blur-sm)
  |-- CardHeader
  |     |-- CardTitle (text-foreground)
  |     |-- CardDescription (text-muted-foreground)
  |-- CardContent
        |-- ResponsiveContainer (width="100%" height={300})
              |-- [BarChart ou PieChart]
```

**4 Graficos:**

| # | Tipo | Titulo | Dados |
|---|------|--------|-------|
| 1 | BarChart (vertical) | Status por Subprefeitura | Barras: online (verde), offline (vermelho) por JT/CV/MG |
| 2 | BarChart (horizontal) | Distribuicao de Produtividade | Barras coloridas: 90-100%(verde), 70-89%(primary), 50-69%(amarelo), <50%(vermelho) |
| 3 | PieChart (donut) | Status de Bateria | Fatias: Cheia(verde), Operacional(azul), Baixa(amarelo), Desatualizada(vermelho) |
| 4 | PieChart (donut) | Status de Sinal | Fatias: Com Sinal(verde), Sem Sinal(vermelho), Manutencao(amarelo) |

**Cores dos graficos:**
```js
const COLORS = {
  success: "#22c55e",   // Verde
  warning: "#eab308",   // Amarelo
  error: "#ef4444",     // Vermelho
  info: "#3b82f6",      // Azul
  primary: "#10b981",   // Verde esmeralda
}
```

---

### 5.3 TABS (Sistema de Abas)

**Layout:**
```
Tabs (space-y-6)
  |-- TabsList (bg-secondary/50 border border-border)
  |     |-- TabsTrigger "overview" (com icone LayoutDashboard)
  |     |-- TabsTrigger "modules" (com icone Table2)
  |     |-- TabsTrigger "alerts" (com icone AlertTriangle + badge contador)
  |     |-- TabsTrigger "dispatch" (com icone FileText)
  |-- TabsContent (um para cada aba)
```

**Estilo do TabsTrigger ativo:**
```css
data-[state=active]:bg-primary data-[state=active]:text-primary-foreground
```

**Badge de contador na aba Alertas:**
```jsx
<span className="ml-2 rounded-full bg-status-error px-2 py-0.5 text-xs text-foreground">
  {alertCount}
</span>
```

---

### 5.4 TABELA DE MODULOS

**Layout Geral:**
```
Card (border-border/50 bg-card/50 backdrop-blur-sm)
  |-- CardHeader
  |     |-- div (flex justify-between)
  |           |-- CardTitle + CardDescription
  |           |-- Button "Exportar CSV" (variant="outline")
  |-- CardContent
        |-- div (filtros - flex gap-4)
        |     |-- Input de busca (com icone Search)
        |     |-- Select Subprefeitura (com icone Filter)
        |     |-- Select Status
        |-- div (rounded-lg border overflow-hidden)
        |     |-- Table
        |-- div (paginacao - flex justify-between mt-4)
```

**Colunas da Tabela:**

| Coluna | Tipo de Dado | Design |
|--------|--------------|--------|
| Subpref. | texto | `font-medium text-foreground` |
| Setor | codigo | `font-mono text-sm text-foreground` |
| SELIMP | texto | `text-foreground` |
| Dias Exec. | texto | `text-sm text-muted-foreground` |
| Comunic. | badge | Badge ON(verde) ou OFF(vermelho) |
| Bateria | numero% | `text-foreground` |
| Status Sinal | badge | COM SINAL(verde), SEM SINAL(vermelho), MANUTENCAO(amarelo) |
| Status Bat. | badge | CHEIA(verde), OPERACIONAL(azul), BAIXA(amarelo), DESATUALIZADA(vermelho) |
| Dias ON | numero | `text-status-success font-medium` |
| Dias OFF | numero | `text-status-error font-medium` |
| Produtiv. | numero% | Cor dinamica: >=90(verde), >=70(primary), >=50(amarelo), <50(vermelho) |
| Acoes | icone | DropdownMenu com 3 pontinhos |

**Estilo dos Badges:**
```jsx
// Verde (sucesso)
<Badge className="bg-status-success/20 text-status-success border-status-success/30">

// Vermelho (erro)
<Badge className="bg-status-error/20 text-status-error border-status-error/30">

// Amarelo (aviso)
<Badge className="bg-status-warning/20 text-status-warning border-status-warning/30">

// Azul (info)
<Badge className="bg-status-info/20 text-status-info border-status-info/30">
```

**Filtros:**
- Input: `pl-9 bg-secondary/50 border-border` com icone Search absoluto
- Select Subprefeitura: Todas | JT | CV | MG
- Select Status: Todos | Online | Offline | Criticos

**Paginacao:**
- Texto: "Pagina X de Y" (text-sm text-muted-foreground)
- Botoes: ChevronLeft e ChevronRight (variant="outline" size="sm")

---

### 5.5 PAINEL DE ALERTAS

**Layout:**
```
Card (border-border/50 bg-card/50 backdrop-blur-sm)
  |-- CardHeader
  |     |-- div (flex justify-between)
  |           |-- CardTitle (flex items-center gap-2)
  |           |     |-- AlertTriangle (h-5 w-5 text-status-error)
  |           |     |-- "Alertas Criticos"
  |           |-- Badge (contador de alertas - bordas vermelhas)
  |-- CardContent
        |-- ScrollArea (h-[400px])
              |-- div (space-y-3)
                    |-- [Cards de Alerta]
```

**Cada Card de Alerta:**
```
div (flex items-start gap-4 rounded-lg border bg-secondary/30 p-4 hover:bg-secondary/50)
  |-- div (icone circular - rounded-full p-2 bg-secondary)
  |     |-- [WifiOff | Battery | AlertTriangle] (h-4 w-4 text-[status-color])
  |-- div (flex-1 space-y-1)
  |     |-- div (flex justify-between)
  |     |     |-- p (font-medium text-foreground) <- Setor
  |     |     |-- Badge (text-xs border-border) <- Subprefeitura
  |     |-- p (text-sm text-[status-color]) <- Mensagem de alerta
  |     |-- div (flex gap-4 text-xs text-muted-foreground)
  |     |     |-- span (Clock + ultima comunicacao)
  |     |     |-- span (Produtividade: XX%)
  |     |-- div (flex gap-2 text-xs text-muted-foreground pt-2)
  |           |-- SELIMP: XX-XXXX
  |           |-- Bateria: XX%
  |           |-- X dias offline
  |-- Button (variant="ghost" size="icon" - ArrowRight)
```

**Tipos de Alerta:**
| Tipo | Icone | Cor | Mensagem |
|------|-------|-----|----------|
| offline | WifiOff | status-error | "Modulo sem comunicacao" |
| battery | Battery | status-warning | "Bateria desatualizada" |
| productivity | AlertTriangle | status-error | "Produtividade critica" |

---

### 5.6 FORMULARIO DE DESPACHOS

**Layout:**
```
Card (border-border/50 bg-card/50 backdrop-blur-sm)
  |-- CardHeader
  |     |-- div (flex justify-between)
  |           |-- div
  |           |     |-- CardTitle (flex items-center gap-2)
  |           |     |     |-- FileText (h-5 w-5 text-primary)
  |           |     |     |-- "Despachos Diarios"
  |           |     |-- CardDescription
  |           |-- Dialog (Modal de novo despacho)
  |                 |-- DialogTrigger
  |                 |     |-- Button (bg-primary)
  |                 |           |-- Plus + "Novo Despacho"
  |                 |-- DialogContent (formulario)
  |-- CardContent
        |-- div (space-y-3)
              |-- [Cards de Despacho]
```

**Modal de Novo Despacho:**
```
DialogContent (bg-card border-border)
  |-- DialogHeader
  |     |-- DialogTitle
  |     |-- DialogDescription
  |-- div (space-y-4 py-4)
  |     |-- Select Modulo (lista modulos criticos primeiro com icone AlertCircle)
  |     |-- Select Tipo de Servico (Troca de Bateria | Manutencao Geral | Verificacao | Reinstalacao | Substituicao)
  |     |-- Textarea Descricao
  |-- DialogFooter
        |-- Button Cancelar (variant="outline")
        |-- Button Criar Despacho (bg-primary)
```

**Cada Card de Despacho:**
```
div (flex items-center justify-between rounded-lg border bg-secondary/30 p-4 hover:bg-secondary/50)
  |-- div (flex items-center gap-4)
  |     |-- div (icone circular colorido por status)
  |     |     |-- [CheckCircle2 | Clock | AlertCircle]
  |     |-- div
  |           |-- div (flex gap-2)
  |           |     |-- p (font-medium) <- Tipo de servico
  |           |     |-- Badge <- Status (Pendente/Em Andamento/Concluido)
  |           |-- p (text-sm text-muted-foreground) <- SELIMP - Setor
  |           |-- p (text-xs text-muted-foreground mt-1) <- Descricao
  |-- div (text-right)
        |-- div (Calendar + data)
        |-- div (Clock + hora)
```

**Status de Despacho:**
| Status | Badge | Icone | Cor do Icone |
|--------|-------|-------|--------------|
| pending | Pendente (amarelo) | AlertCircle | status-warning |
| in-progress | Em Andamento (azul) | Clock | status-info |
| completed | Concluido (verde) | CheckCircle2 | status-success |

---

## 6. INTERFACE DE DADOS (TypeScript)

```typescript
interface ModuleData {
  subprefeitura: string        // "JT" | "CV" | "MG"
  setor: string                // ex: "JT10304VJ0043"
  numeroSelimp: string         // ex: "03-0025"
  diasExecucao: string         // ex: "Quarta/Sabado"
  comunicacao: "ON" | "OFF"
  bateria: string              // ex: "44% (Bateria desatualizada)"
  bateriaPercentual: number    // ex: 44
  ultimaComunicacao: string    // ex: "08/04/2026 10:14:50"
  statusSinalGeral: string     // "COM SINAL" | "SEM SINAL" | "MANUTENCAO"
  statusBateria: string        // "CHEIA" | "OPERACIONAL" | "BAIXA" | "DESATUALIZADA"
  dataInstalacao: string       // ex: "10/12/2025"
  quantidadeTrocas: number
  diasOn: number
  diasOff: number
  produtividade: number        // 0-100
}

interface Dispatch {
  id: string
  date: string                 // ex: "11/04/2026"
  time: string                 // ex: "08:30"
  module: string               // SELIMP
  setor: string
  type: string                 // Tipo de servico
  description: string
  status: "pending" | "completed" | "in-progress"
}
```

---

## 7. FUNCOES UTILITARIAS

```typescript
// Calcular estatisticas gerais
function getModuleStats(data: ModuleData[]) {
  return {
    total: number,
    online: number,
    offline: number,
    avgProductivity: number,
    criticalAlerts: number,   // statusBateria === "DESATUALIZADA" || produtividade < 50
    lowBattery: number        // statusBateria === "BAIXA" || bateriaPercentual < 40
  }
}

// Dados para grafico de barras por subprefeitura
function getStatusBySubprefeitura(data: ModuleData[]) {
  return [
    { subprefeitura: "JT", total, online, offline, avgProductivity },
    { subprefeitura: "CV", total, online, offline, avgProductivity },
    { subprefeitura: "MG", total, online, offline, avgProductivity }
  ]
}

// Dados para grafico de pizza de bateria
function getBatteryDistribution(data: ModuleData[]) {
  return [
    { status: "Cheia", count: number },
    { status: "Operacional", count: number },
    { status: "Baixa", count: number },
    { status: "Desatualizada", count: number }
  ]
}

// Dados para grafico de pizza de sinal
function getSignalDistribution(data: ModuleData[]) {
  return [
    { status: "Com Sinal", count: number },
    { status: "Sem Sinal", count: number },
    { status: "Manutencao", count: number }
  ]
}

// Dados para grafico de produtividade
function getProductivityDistribution(data: ModuleData[]) {
  return [
    { range: "90-100%", count: number },
    { range: "70-89%", count: number },
    { range: "50-69%", count: number },
    { range: "< 50%", count: number }
  ]
}

// Modulos criticos (para alertas)
function getCriticalModules(data: ModuleData[]) {
  return data.filter(m => 
    m.comunicacao === "OFF" || 
    m.statusBateria === "DESATUALIZADA" || 
    m.produtividade < 50
  )
}
```

---

## 8. ESTRUTURA DE ARQUIVOS SUGERIDA

```
/components
  /dashboard
    kpi-cards.tsx
    charts.tsx
    modules-table.tsx
    alerts-panel.tsx
    dispatch-form.tsx

/lib
  modules-data.ts       # Interface + dados + funcoes utilitarias

/app
  /dashboard
    page.tsx            # Pagina principal com Tabs
  globals.css           # Variaveis de cor
```

---

## 9. CLASSES TAILWIND MAIS USADAS

**Cards:**
```css
border-border/50 bg-card/50 backdrop-blur-sm
```

**Textos:**
```css
text-foreground           /* Texto principal */
text-muted-foreground     /* Texto secundario */
text-status-success       /* Verde */
text-status-warning       /* Amarelo */
text-status-error         /* Vermelho */
text-status-info          /* Azul */
text-primary              /* Verde esmeralda */
```

**Badges coloridos:**
```css
/* Verde */
bg-status-success/20 text-status-success border-status-success/30

/* Vermelho */
bg-status-error/20 text-status-error border-status-error/30

/* Amarelo */
bg-status-warning/20 text-status-warning border-status-warning/30

/* Azul */
bg-status-info/20 text-status-info border-status-info/30
```

**Inputs/Selects:**
```css
bg-secondary/50 border-border text-foreground placeholder:text-muted-foreground
```

**Hover em items de lista:**
```css
hover:bg-secondary/50 transition-colors
```

**Tabela:**
```css
/* Header */
TableRow: border-border hover:bg-transparent
TableHead: text-muted-foreground

/* Body */
TableRow: border-border hover:bg-secondary/30
TableCell: text-foreground
```

---

## 10. RESPONSIVIDADE

```css
/* KPI Cards */
grid-cols-2 md:grid-cols-3 lg:grid-cols-6

/* Graficos */
grid-cols-1 md:grid-cols-2 lg:grid-cols-4
/* Cada grafico: col-span-2 */

/* Filtros da tabela */
flex-col sm:flex-row

/* Input de busca */
flex-1

/* Selects */
w-full sm:w-[180px]
```

---

## PRONTO PARA IMPLEMENTAR!

Copie este documento para o CursorAI e peca para ele criar os componentes seguindo exatamente esta especificacao. Os dados virao da planilha importada que voce mencionou.
