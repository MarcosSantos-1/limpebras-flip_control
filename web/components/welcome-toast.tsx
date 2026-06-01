"use client";

import { useEffect } from "react";
import { toast, ToastContainer, type Id } from "react-toastify";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const WELCOME_TOAST_CONTAINER_ID = "welcome-toast";
const TOAST_ID = "flip-welcome-toast" as Id;
const DURATION_MS = 7_000;

const WELCOME_FLAG_KEY = "flip_show_welcome";

function firstNameFromUser(displayName: string | null | undefined, username: string): string {
  const raw = (displayName ?? "").trim();
  if (raw) return raw.split(/\s+/)[0] ?? username;
  return username.split(/\s+/)[0] ?? username;
}

/** Só consome quando ainda está "1" (login novo). Evita Strict Mode apagar o flag antes do segundo efeito. */
function consumeWelcomeFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (sessionStorage.getItem(WELCOME_FLAG_KEY) !== "1") return false;
    sessionStorage.setItem(WELCOME_FLAG_KEY, "shown");
    return true;
  } catch {
    return false;
  }
}

/**
 * Container fixo no layout + `WelcomeToastTrigger` — o toast não some com remount da página.
 * O conteúdo do toast é disparado depois de um micro-delay para garantir o container no DOM.
 */
export function WelcomeToastContainer() {
  return (
    <ToastContainer
      containerId={WELCOME_TOAST_CONTAINER_ID}
      position="top-center"
      autoClose={DURATION_MS}
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
      progressClassName="h-1! rounded-full! bg-indigo-500! dark:bg-sky-400!"
      style={{ width: "100%", maxWidth: "100%", zIndex: 10060 }}
    />
  );
}

/**
 * Lógica do boas-vindas: montar no layout (uma vez), não na página do dashboard.
 */
export function WelcomeToastTrigger() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (!consumeWelcomeFlag()) return;

    const first = firstNameFromUser(user.display_name, user.username);

    toast.dismiss(TOAST_ID);
    const show = () => {
      toast(
        ({ closeToast }) => (
          <div
            className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-indigo-200/90 bg-white/90 px-5 py-4 pr-12 shadow-xl shadow-indigo-500/15 ring-1 ring-indigo-500/10 backdrop-blur-md dark:border-indigo-500/40 dark:bg-zinc-900/90 dark:ring-indigo-400/20"
            role="status"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-linear-to-br from-indigo-400/25 to-sky-400/20 blur-2xl dark:from-indigo-500/20 dark:to-cyan-500/15"
            />
            <div className="relative flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-indigo-600 to-sky-500 text-white shadow-md shadow-indigo-600/35">
                <Sparkles className="h-5 w-5" strokeWidth={2.25} />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                  Bem-vindo(a),{" "}
                  <span className="bg-linear-to-r from-indigo-700 via-sky-600 to-cyan-600 bg-clip-text font-extrabold text-transparent dark:from-indigo-300 dark:via-sky-300 dark:to-cyan-300">
                    {first}
                  </span>
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  Você está no ADC Control.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200/90 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Fechar"
              onClick={() => closeToast?.()}
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        ),
        {
          toastId: TOAST_ID,
          containerId: WELCOME_TOAST_CONTAINER_ID,
          autoClose: DURATION_MS,
          closeButton: false,
          closeOnClick: false,
          draggable: false,
        }
      );
    };

    /* Sem cleanup no timeout: em dev o Strict Mode desmontaria e cancelaria o toast. */
    window.setTimeout(show, 120);
  }, [loading, user]);

  return null;
}
