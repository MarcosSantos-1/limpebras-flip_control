"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, MessageCircleMore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

const LOGIN_WALLPAPER_STORAGE_KEY = "flip_login_wallpaper_index";

const wallpapers = [
  "/loginWallpaper1.jpg",
  "/loginWallpaper2.jpg",
  "/loginWallpaper3.jpg",
  "/loginWallpaper4.jpg",
  "/loginWallpaper5.jpg",
  "/loginWallpaper6.jpg",
] as const;

export default function LoginPage() {
  const { login, isAuthenticated, loading, rememberedUsername, rememberedPassword, rememberMeSaved } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [usernameDirty, setUsernameDirty] = useState(false);
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [rememberDirty, setRememberDirty] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [wallpaperIndex, setWallpaperIndex] = useState(0);
  const usernameValue = usernameDirty ? username : rememberedUsername;
  const passwordValue = passwordDirty ? password : rememberedPassword;
  const rememberValue = rememberDirty ? rememberMe : rememberMeSaved;

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.replace("/");
    }
  }, [isAuthenticated, loading, router]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOGIN_WALLPAPER_STORAGE_KEY);
      if (raw === null) return;
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0 || n >= wallpapers.length) return;
      setWallpaperIndex(n);
    } catch {
      /* ignore */
    }
  }, []);

  function cycleWallpaper() {
    setWallpaperIndex((current) => {
      const next = (current + 1) % wallpapers.length;
      try {
        localStorage.setItem(LOGIN_WALLPAPER_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    const result = await login({ username: usernameValue, password: passwordValue, rememberMe: rememberValue });
    setSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.error ?? "Usuário ou senha inválidos.");
      return;
    }
    router.replace("/");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950">
      <Image
        src={wallpapers[wallpaperIndex]}
        alt="Wallpaper da tela de login"
        fill
        priority
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/80 via-zinc-950/55 to-blue-950/70" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-1/4 top-1/4 h-[480px] w-[480px] rounded-full bg-sky-400/25 blur-[110px] motion-safe:animate-pulse dark:bg-sky-500/18" />
        <div className="absolute -right-1/4 bottom-1/4 h-[440px] w-[440px] rounded-full bg-indigo-500/22 blur-[100px] motion-safe:animate-pulse dark:bg-indigo-400/15 [animation-delay:1.2s]" />
        <div className="absolute left-1/3 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/12 blur-[80px] dark:bg-cyan-400/10" />
        <div className="absolute left-1/2 top-0 h-px w-[min(90%,480px)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/12" />
        <div className="absolute bottom-0 left-1/2 h-px w-[min(70%,360px)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent dark:via-white/8" />
      </div>
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-md">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-white/35 via-white/5 to-blue-500/20 opacity-90 blur-[1px] dark:from-white/12 dark:via-white/[0.03] dark:to-indigo-500/25"
          />
          <Card className="relative w-full overflow-hidden border-white/25 bg-white/62 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.3),0_0_0_1px_rgba(255,255,255,0.1)_inset] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-950/55 dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)_inset]">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-blue-500/[0.1] dark:from-white/[0.05] dark:to-indigo-500/12"
            />
            <div className="relative">
          <CardHeader className="relative">
            <div className="flex justify-center mb-1">
              {/* Mostra logo branco no dark mode e logo padrão no light mode */}
              <Image
                src="/logotipo.png"
                alt="Logo Limpebras"
                width={160}
                height={160}
                className="object-contain dark:hidden"
                style={{ width: "auto", height: "auto" }}
                priority
              />
              <Image
                src="/logotipo-white.png"
                alt="Logo Limpebras (versão branca)"
                width={160}
                height={160}
                className="object-contain hidden dark:block"
                style={{ width: "auto", height: "auto" }}
                priority
              />
            </div>
            <div className="space-y-3">
              <CardTitle
                className="text-center text-3xl font-extrabold tracking-tight pt-4 bg-gradient-to-r from-blue-900 via-sky-700 
                to-indigo-700 bg-clip-text text-transparent dark:from-blue-500 dark:via-sky-400 dark:to-indigo-300"
                style={{ WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
              >
                ADC Control
              </CardTitle>
              <CardDescription className="mt-2 text-sm leading-relaxed">
                Entre com seu usuário e senha para acessar o painel interno.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="relative">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="username" className="text-foreground dark:text-foreground">
                  Usuário
                </Label>
                <Input
                  id="username"
                  name="login-user"
                  type="text"
                  inputMode="text"
                  value={usernameValue}
                  onChange={(event) => {
                    setUsernameDirty(true);
                    setUsername(event.target.value);
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Digite seu usuário"
                  required
                  className="border-slate-300/95 bg-white text-foreground shadow-sm ring-1 ring-slate-300/60 placeholder:text-slate-500 focus-visible:border-blue-500/70 focus-visible:ring-2 focus-visible:ring-blue-500/25 dark:border-input dark:bg-transparent dark:shadow-none dark:ring-0 dark:placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground dark:text-foreground">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={passwordValue}
                    onChange={(event) => {
                      setPasswordDirty(true);
                      setPassword(event.target.value);
                    }}
                    autoComplete="current-password"
                    placeholder="Digite sua senha"
                    className="border-slate-300/95 bg-white pr-11 text-foreground shadow-sm ring-1 ring-slate-300/60 placeholder:text-slate-500 focus-visible:border-blue-500/70 focus-visible:ring-2 focus-visible:ring-blue-500/25 dark:border-input dark:bg-transparent dark:shadow-none dark:ring-0 dark:placeholder:text-muted-foreground"
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={rememberValue}
                    onCheckedChange={(checked) => {
                      setRememberDirty(true);
                      setRememberMe(checked === true);
                    }}
                  />
                  <span>Lembrar Senha</span>
                </label>
                <Link
                  href="https://api.whatsapp.com/send?phone=5511964821876&text=Olá, gostaria de solicitar uma nova senha para o meu usuário."
                  target="_blank"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline dark:text-blue-300"
                >
                  <MessageCircleMore className="h-4 w-4" />
                  Esqueceu a senha?
                </Link>
              </div>

              {errorMessage ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {errorMessage}
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting || loading}>
                {submitting ? "Entrando..." : "Entrar"}
              </Button>

              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                O acesso é interno e controlado por permissões por página.
              </p>
            </form>
          </CardContent>
            </div>
          </Card>
        </div>
      </div>
      <button
        type="button"
        onClick={cycleWallpaper}
        className="absolute bottom-4 right-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/40 bg-black/35 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-black/45"
        aria-label={`Alternar wallpaper (atual ${wallpaperIndex + 1} de ${wallpapers.length})`}
        title="Alternar wallpaper (preferência salva neste navegador)"
      >
        {wallpaperIndex + 1}
      </button>
    </div>
  );
}
