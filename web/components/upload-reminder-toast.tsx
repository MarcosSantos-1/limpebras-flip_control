"use client";

import { useEffect } from "react";
import Link from "next/link";
import { toast, ToastContainer, type Id } from "react-toastify";
import { Upload, X } from "lucide-react";
import { apiService } from "@/lib/api";

const CONTAINER_ID = "upload-reminder";
const TOAST_ID = "flip-upload-data-reminder" as Id;

const REMINDER_DURATION_MS = 40_000;
/** Após login, o toast de boas-vindas aparece primeiro; o lembrete de upload aguarda esse atraso (ms). */
const UPLOAD_REMINDER_DELAY_KEY = "flip_upload_reminder_delay_ms";

type DashboardImportCheck = {
  data_referencia_ontem_brt?: string | null;
  flip_cobre_ontem?: boolean;
  ipt_report_cobre_ontem?: boolean;
  precisa_upload?: boolean;
};

function formatOntemLabel(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "ontem (BRT)";
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

/**
 * Toast no topo central ao abrir o Dashboard: avisa se faltam dados FLIP (fiscalização D-1 BRT)
 * e/ou Report SELIMP com período que cubra esse dia. Só é montado em `app/page.tsx`.
 */
export function UploadReminderToast() {
  useEffect(() => {
    let cancelled = false;
    const delayRaw = typeof window !== "undefined" ? sessionStorage.getItem(UPLOAD_REMINDER_DELAY_KEY) : null;
    if (typeof window !== "undefined") sessionStorage.removeItem(UPLOAD_REMINDER_DELAY_KEY);
    const delayMs =
      delayRaw != null && delayRaw !== "" ? Math.max(0, Number.parseInt(delayRaw, 10) || 0) : 0;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const data = (await apiService.getUploadLastUpdates()) as {
            dashboard_import_check?: DashboardImportCheck;
          };
          if (cancelled) return;
          const check = data.dashboard_import_check;
          if (!check || check.precisa_upload !== true) return;

          toast.dismiss(TOAST_ID);

          const ontemLabel = formatOntemLabel(check.data_referencia_ontem_brt ?? null);
          const faltas: string[] = [];
          if (!check.flip_cobre_ontem) {
            faltas.push(
              "Base FLIP (SAC, BFS ou CNC) com data de referência em D-1 (BRT): registro SAC, fiscalização/vistoria BFS ou datas de CNC."
            );
          }
          if (!check.ipt_report_cobre_ontem) {
            faltas.push(
              "Report SELIMP: período importado que cubra esse dia, ou linha com data estimada nesse dia."
            );
          }

          toast(
            ({ closeToast }) => (
              <div className="relative flex w-4xl items-start gap-3 rounded-2xl border border-violet-300/90 bg-linear-to-br from-white via-violet-50/40 to-indigo-50/80 px-4 py-3.5 pr-10 shadow-lg shadow-violet-500/15 ring-1 ring-violet-500/10 dark:border-violet-500/35 dark:from-zinc-900 dark:via-violet-950/30 dark:to-zinc-950 dark:ring-violet-400/20">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-md shadow-violet-600/30 dark:bg-violet-500"
                  aria-hidden
                >
                  <Upload className="h-5 w-5" strokeWidth={2.25} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5 ">
                  <p className="text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                    Atualize os dados (FLIP + Report)
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                    Ainda faltam importações para a referência de <strong className="text-zinc-800 dark:text-zinc-100">{ontemLabel}</strong>
                    
                  </p>
                  <ul className="mt-2 list-inside list-disc text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {faltas.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <Link
                    href="/upload"
                    className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 underline-offset-4 hover:text-violet-800 hover:underline dark:text-violet-300 dark:hover:text-violet-200"
                    onClick={() => closeToast?.()}
                  >
                    Ir para página de Uploads
                    <span aria-hidden>→</span>
                  </Link>
                </div>
                <button
                  type="button"
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  aria-label="Fechar aviso"
                  onClick={() => closeToast?.()}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            ),
            {
              toastId: TOAST_ID,
              containerId: CONTAINER_ID,
              autoClose: REMINDER_DURATION_MS,
              closeButton: false,
              closeOnClick: false,
              draggable: false,
            }
          );
        } catch {
          /* API indisponível: não incomoda */
        }
      })();
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      toast.dismiss(TOAST_ID);
    };
  }, []);

  return (
    <ToastContainer
      containerId={CONTAINER_ID}
      position="top-center"
      autoClose={REMINDER_DURATION_MS}
      limit={1}
      closeButton={false}
      closeOnClick={false}
      draggable={false}
      pauseOnHover
      pauseOnFocusLoss
      hideProgressBar={false}
      theme="light"
      className="top-4! w-full! max-w-none! px-0! sm:px-4!"
      toastClassName="bg-transparent! shadow-none! p-0! mb-3! min-h-0! rounded-none! items-stretch!"
      progressClassName="h-1! rounded-full! bg-violet-500! dark:bg-violet-400!"
      style={{ width: "100%", maxWidth: "100%", zIndex: 10050 }}
    />
  );
}
