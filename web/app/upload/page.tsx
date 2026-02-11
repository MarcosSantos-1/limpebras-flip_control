"use client";

import { useState, useCallback } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { apiService } from "@/lib/api";

interface UploadState {
  status: "idle" | "uploading" | "success" | "error";
  progress?: number;
  result?: any;
  error?: string;
}

const cardColors = {
  sacs: {
    border: "border-blue-500",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    text: "text-blue-600 dark:text-blue-400",
    gradient: "from-blue-500 to-cyan-500",
  },
  cnc: {
    border: "border-orange-500",
    bg: "bg-orange-50 dark:bg-orange-900/20",
    text: "text-orange-600 dark:text-orange-400",
    gradient: "from-orange-500 to-amber-500",
  },
  acic: {
    border: "border-red-500",
    bg: "bg-red-50 dark:bg-red-900/20",
    text: "text-red-600 dark:text-red-400",
    gradient: "from-red-500 to-rose-500",
  },
  ouvidoria: {
    border: "border-purple-500",
    bg: "bg-purple-50 dark:bg-purple-900/20",
    text: "text-purple-600 dark:text-purple-400",
    gradient: "from-purple-500 to-violet-500",
  },
};

export default function UploadPage() {
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({
    sacs: { status: "idle" },
    cnc: { status: "idle" },
    acic: { status: "idle" },
    ouvidoria: { status: "idle" },
  });
  const [draggedOver, setDraggedOver] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<Record<string, { message: string; deleted?: number }>>({});

  const handleUpload = async (type: string, file: File | null) => {
    if (!file) return;

    setUploadStates((prev) => ({
      ...prev,
      [type]: { status: "uploading", progress: 0 },
    }));

    try {
      let data;
      switch (type) {
        case "sacs":
          data = await apiService.uploadSACsCSV(file);
          break;
        case "cnc":
          data = await apiService.uploadCNCsCSV(file);
          break;
        case "acic":
          data = await apiService.uploadACICsCSV(file);
          break;
        case "ouvidoria":
          data = await apiService.uploadOuvidoriaCSV(file);
          break;
        default:
          return;
      }

      setUploadStates((prev) => ({
        ...prev,
        [type]: { status: "success", result: data },
      }));
    } catch (error: any) {
      setUploadStates((prev) => ({
        ...prev,
        [type]: {
          status: "error",
          error: error.response?.data?.detail || error.message || "Erro desconhecido",
        },
      }));
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent, type: string) => {
    e.preventDefault();
    setDraggedOver(type);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDraggedOver(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, type: string) => {
      e.preventDefault();
      setDraggedOver(null);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".csv")) {
        handleUpload(type, file);
      }
    },
    []
  );

  const handleClear = async (type: string) => {
    if (!confirm("Tem certeza? Isso remove todos os dados importados deste tipo. Você pode reimportar o CSV em seguida.")) return;
    setClearing(type);
    setClearResult((prev) => ({ ...prev, [type]: undefined as any }));
    try {
      let data: any;
      switch (type) {
        case "sacs":
          data = await apiService.clearSACsImportados();
          break;
        case "cnc":
          data = await apiService.clearCNCImportados();
          break;
        case "acic":
          data = await apiService.clearACICImportados();
          break;
        case "ouvidoria":
          data = await apiService.clearOuvidoriaImportados();
          break;
        default:
          return;
      }
      setClearResult((prev) => ({
        ...prev,
        [type]: {
          message: data.message || "Dados removidos.",
          deleted: data.deleted ?? data.deleted_cnc ?? data.deleted_acic,
        },
      }));
      setUploadStates((prev) => ({ ...prev, [type]: { status: "idle" } }));
    } catch (error: any) {
      setClearResult((prev) => ({
        ...prev,
        [type]: { message: error.response?.data?.detail || error.message || "Erro ao limpar" },
      }));
    } finally {
      setClearing(null);
    }
  };

  const UploadCard = ({
    title,
    type,
    description,
  }: {
    title: string;
    type: string;
    description: string;
  }) => {
    const state = uploadStates[type];
    const isDragged = draggedOver === type;
    const isUploading = state.status === "uploading";
    const isClearing = clearing === type;
    const clearMsg = clearResult[type];
    const colors = cardColors[type as keyof typeof cardColors];

    return (
      <div
        className={`relative group overflow-hidden bg-card border rounded-xl transition-all duration-300 ${
          isDragged
            ? `ring-2 ring-offset-2 ring-${colors.border.split("-")[1]}-500 scale-[1.02] shadow-xl`
            : "border-border hover:border-primary/30 hover:shadow-lg hover:-translate-y-1"
        } ${isUploading ? "pointer-events-none" : ""}`}
        onDragOver={(e) => handleDragOver(e, type)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, type)}
      >
        {/* Barra de status superior */}
        <div className={`h-1.5 w-full bg-linear-to-r ${colors.gradient}`} />
        
        <div className="p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="space-y-1">
              <h3 className={`text-xl font-bold ${colors.text} group-hover:scale-105 transition-transform origin-left`}>{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center shadow-sm">
              {state.status === "success" ? (
                <div className="text-lg animate-bounce">✅</div>
              ) : state.status === "error" ? (
                <div className="text-lg animate-pulse">❌</div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-upload-cloud ${colors.text} opacity-50 group-hover:opacity-100 transition-opacity`}><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
              )}
            </div>
          </div>

          {/* Drag and Drop Area */}
          <div
            className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${
              isDragged
                ? `${colors.border} bg-muted/50`
                : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/10"
            }`}
          >
            {isUploading ? (
              <div className="space-y-4 py-2">
                <div className="relative">
                  <div className={`h-12 w-12 rounded-full border-2 border-t-transparent ${colors.border} animate-spin mx-auto`} />
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                    ...
                  </div>
                </div>
                <div>
                  <p className={`text-sm font-medium ${colors.text} animate-pulse`}>
                    Processando arquivo...
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Isso pode levar alguns segundos
                  </p>
                </div>
              </div>
            ) : (
              <>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(type, file);
                  }}
                  disabled={isUploading}
                  className="hidden"
                  id={`file-input-${type}`}
                />
                <label
                  htmlFor={`file-input-${type}`}
                  className="cursor-pointer block space-y-3 py-2"
                >
                  <div className={`mx-auto w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 ${isDragged ? 'scale-125' : ''}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-file-spreadsheet ${colors.text}`}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1 group-hover:text-primary transition-colors">
                      Clique ou arraste o CSV aqui
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      {isDragged ? "Solte para iniciar o upload!" : "Suporta arquivos .csv"}
                    </p>
                  </div>
                </label>
              </>
            )}
          </div>

          {/* Limpar dados importados */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => handleClear(type)}
              disabled={isUploading || isClearing}
              className="text-xs text-muted-foreground hover:text-destructive underline disabled:opacity-50"
            >
              {isClearing ? "Removendo..." : "Limpar dados importados"}
            </button>
            {clearMsg && (
              <span className="text-xs text-muted-foreground">
                {clearMsg.deleted !== undefined ? `${clearMsg.deleted} removidos` : clearMsg.message}
              </span>
            )}
          </div>

          {/* Resultado - só mostra para este card específico */}
          {state.status === "success" && state.result && (
            <div className="mt-4 p-4 bg-green-50/50 dark:bg-green-900/10 border border-green-200/50 dark:border-green-800/30 rounded-lg animate-fadeIn backdrop-blur-sm">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                    Upload concluído
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-background/50 rounded border border-green-100 dark:border-green-900">
                    <span className="text-muted-foreground block">Processados</span>
                    <strong className="text-green-700 dark:text-green-300 text-lg">{state.result.processados}</strong>
                  </div>
                  <div className="p-2 bg-background/50 rounded border border-green-100 dark:border-green-900">
                    <span className="text-muted-foreground block">Total</span>
                    <strong className="text-foreground text-lg">{state.result.total}</strong>
                  </div>
                </div>
                {(state.result.duplicados > 0 || state.result.erros > 0) && (
                  <div className="text-xs pt-2 flex gap-3 border-t border-green-200/50 dark:border-green-800/30">
                    {state.result.duplicados > 0 && (
                      <span className="text-muted-foreground">
                        Ignorados: <strong>{state.result.duplicados}</strong>
                      </span>
                    )}
                    {state.result.erros > 0 && (
                      <span className="text-yellow-700 dark:text-yellow-400">
                        ⚠️ Erros: <strong>{state.result.erros}</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {state.status === "error" && (
            <div className="mt-4 p-4 bg-red-50/50 dark:bg-red-900/10 border border-red-200/50 dark:border-red-800/30 rounded-lg animate-fadeIn backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-circle text-red-600 mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">
                    Erro no upload
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300 wrap-break-word leading-relaxed">
                    {state.error}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-indigo-600/10 via-indigo-600/5 to-transparent p-8 border border-indigo-200/50 dark:border-indigo-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-indigo-600/10 rounded-full blur-3xl"></div>
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-indigo-600 to-purple-500 bg-clip-text text-transparent pb-2">Upload de Dados</h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
              Importação de arquivos CSV do sistema FLIP para atualização da base de dados.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UploadCard
            title="SACs"
            type="sacs"
            description="Upload do arquivo FLIP_CONSULTA_SAC_*.csv"
          />
          <UploadCard
            title="CNCs"
            type="cnc"
            description="Upload do arquivo FLIP_CONSULTA_CNC_*.csv"
          />
          <UploadCard
            title="ACICs"
            type="acic"
            description="Upload do arquivo FLIP_CONSULTA_ACIC_*.csv"
          />
          <UploadCard
            title="Ouvidorias"
            type="ouvidoria"
            description="Upload do arquivo FLIP_CONSULTA_OUVIDORIA_*.csv"
          />
        </div>
      </div>
    </MainLayout>
  );
}
