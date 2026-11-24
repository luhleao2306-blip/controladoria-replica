import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, UserPlus } from "lucide-react";
import loginHero from "@/assets/login-hero.jpg";
import { supabase } from "@/integrations/supabase/client";
import { endDemoSession, hasDemoSession, isDemoCredentials } from "@/lib/demo-auth";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { BrandLogo } from "@/components/common/BrandLogo";
import { authErrorMessage, retryPasswordSignIn, withAuthTimeout } from "@/lib/auth-request";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Acessar — Modblue Controladoria" },
      {
        name: "description",
        content:
          "Acesse a Modblue Controladoria: indicadores, análises e controle total do seu negócio.",
      },
      { property: "og:title", content: "Acessar — Modblue Controladoria" },
      {
        property: "og:description",
        content: "Inteligência que transforma gestão em resultados.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

type Tab = "login" | "code" | "signup";

function LoginPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [recoverySent, setRecoverySent] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteValid, setInviteValid] = useState(false);

  useEffect(() => {
    if (hasDemoSession()) {
      endDemoSession();
    }
    withAuthTimeout(supabase.auth.getSession()).then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    }).catch((error) => setLoginError(authErrorMessage(error)));
    const token = new URLSearchParams(window.location.search).get("convite")?.trim() ?? "";
    if (!token) return;
    setInviteToken(token);
    supabase.rpc("invite_is_valid", { _token: token }).then(({ data, error }) => {
      if (error || data !== true) {
        toast.error("Este link de convite é inválido, já foi usado ou expirou.");
        return;
      }
      setInviteValid(true);
      setTab("signup");
    });
  }, [navigate]);

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      toast.error("Informe e-mail e senha.");
      return;
    }
    if (isDemoCredentials(cleanEmail, password)) {
      toast.error("O login de teste não acessa dados financeiros. Use um usuário real do sistema.");
      return;
    }
    setLoading(true);
    setLoginError("");
    try {
      const { error } = await withAuthTimeout(retryPasswordSignIn(() => supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      })), 35000);
      if (!error) {
        toast.success("Bem-vindo!");
        await navigate({ to: "/" });
        return;
      }
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("not confirmed") || msg.includes("confirm")) {
        const { error: otpErr } = await withAuthTimeout(supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: { shouldCreateUser: false },
        }));
        if (otpErr) {
          setLoginError(authErrorMessage(otpErr));
          return;
        }
        toast.success("Enviamos um código de verificação para seu e-mail.");
        setTab("code");
        setOtpSent(true);
      } else if (msg.includes("invalid login credentials")) {
        setLoginError(authErrorMessage(error));
      } else {
        setLoginError(authErrorMessage(error));
      }
    } catch (error) {
      setLoginError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Código enviado para seu e-mail.");
      setOtpSent(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp.trim(),
        type: "email",
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Acesso confirmado!");
      navigate({ to: "/" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteValid || !inviteToken) {
      toast.error("O cadastro é permitido somente por link de convite válido.");
      return;
    }
    if (signupPassword.length < 8) {
      toast.error("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (signupPassword !== signupConfirm) {
      toast.error("As senhas não coincidem.");
      return;
    }
    const cleanEmail = signupEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(cleanEmail)) {
      toast.error("Informe um e-mail válido (ex.: nome@empresa.com.br).");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: signupPassword,
        options: {
          data: { full_name: fullName.trim(), invite_token: inviteToken },
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        toast.error(error.message);
        return;
      }
      if (data.session) {
        toast.success("Conta criada! Acesso master admin liberado.");
        navigate({ to: "/" });
        return;
      }
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: signupPassword,
      });
      if (signInErr) {
        toast.success("Conta criada! Faça login para continuar.");
        setEmail(cleanEmail);
        setTab("login");
        return;
      }
      toast.success("Conta criada! Acesso master admin liberado.");
      navigate({ to: "/" });
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot() {
    if (loading) return;
    if (!email.trim()) {
      setLoginError("Informe seu e-mail primeiro.");
      return;
    }
    setLoading(true); setLoginError(""); setRecoverySent(false);
    try {
      const { error } = await withAuthTimeout(supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      }));
      if (error) throw error;
      setRecoverySent(true);
    } catch (error) { setLoginError(authErrorMessage(error)); }
    finally { setLoading(false); }
  }

  const fieldClass =
    "h-12 w-full rounded-xl border border-[#1b2c42] bg-[#0b1725] pl-12 pr-11 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#2f8ef4] focus:ring-2 focus:ring-[#2f8ef4]/25";

  const submitBtn =
    "group mt-2 flex h-12 w-full items-center justify-between rounded-xl bg-gradient-to-r from-[#0b63d6] to-[#2b9bf6] px-5 text-sm font-semibold text-white shadow-[0_18px_40px_-14px_rgba(43,155,246,0.9)] transition hover:brightness-110 disabled:opacity-60";

  return (
    <div className="relative min-h-[100svh] bg-[#04080f] text-slate-200">
      <Toaster richColors position="top-right" />

      <div className="grid min-h-[100svh] grid-cols-1 md:grid-cols-[1.05fr_0.95fr]">
        {/* ---------- Left: full-bleed hero ---------- */}
        <div className="relative min-h-[260px] overflow-hidden md:min-h-[100svh]">
          <img
            src={loginHero}
            alt="Painel financeiro holográfico com gráficos"
            width={1200}
            height={1408}
            className="absolute inset-0 h-full w-full scale-[1.08] object-cover brightness-[1.35] contrast-[1.05]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#04080f]/70 via-transparent to-[#04080f]/85" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#04080f]/80 via-transparent to-[#04080f]/45" />

          <div className="relative z-10 flex min-h-[260px] flex-col justify-between px-6 py-8 sm:px-10 md:min-h-[100svh] md:px-12 md:py-12 xl:px-16">
            <div className="inline-flex items-center">
              <BrandLogo inverse className="w-[220px] sm:w-[260px]" />
            </div>

            <div className="max-w-lg">
              <h1 className="text-[30px] font-normal leading-[1.12] text-white sm:text-[38px] md:text-[40px] xl:text-[46px]">
                Inteligência que
                <br />
                transforma gestão
                <br />
                em <span className="text-[#3b9df6]">resultados.</span>
              </h1>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-300">
                Acompanhe indicadores, analise cenários e tome decisões com segurança e precisão.
              </p>
              <span className="mt-5 block h-[3px] w-12 rounded-full bg-[#3b9df6]" />
            </div>
          </div>
        </div>

        {/* ---------- Right: auth card ---------- */}
        <div className="flex min-h-[calc(100svh-260px)] items-center justify-center overflow-y-auto px-4 py-6 sm:px-6 md:min-h-[100svh] md:px-8 md:py-8 lg:px-10">
          <div className="w-full max-w-[430px] rounded-2xl border border-[#152437] bg-[#070f1a]/95 px-5 py-6 shadow-[0_40px_100px_-30px_rgba(0,0,0,1)] backdrop-blur sm:px-8 sm:py-7 md:max-h-[calc(100svh-3rem)] md:overflow-y-auto">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-24 w-24 items-center justify-center">
                <img
                  src="/brand/modblue-symbol.png"
                  alt="Símbolo Modblue"
                  width={1280}
                  height={944}
                  className="h-full w-full object-contain drop-shadow-[0_18px_34px_rgba(59,157,246,0.45)]"
                />
              </div>

              <h2 className="mt-4 text-xl font-medium leading-tight text-white">
                Controladoria
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Acesse sua conta para <span className="text-[#3b9df6]">continuar</span>
              </p>
            </div>

            {loginError && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{loginError}</p>}
            {recoverySent && <p role="status" className="mt-5 rounded-xl border border-blue-400/30 bg-blue-400/10 p-3 text-sm text-blue-100">Se o e-mail estiver cadastrado, você receberá um link para definir sua senha. Confira também o spam.</p>}
            {tab === "login" ? (
              <form onSubmit={handleCredentials} className="mt-6 space-y-4">
                <div className="space-y-2.5">
                  <label htmlFor="email" className="text-sm text-slate-200">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3b9df6]" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Digite seu e-mail"
                      autoComplete="email"
                      required
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <label htmlFor="password" className="text-sm text-slate-200">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3b9df6]" />
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Digite sua senha"
                      autoComplete="current-password"
                      required
                      className={fieldClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 pt-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex cursor-pointer items-center gap-2.5 text-slate-300">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-[18px] w-[18px] rounded border-[#22405f] bg-[#0b1725] accent-[#3b9df6]"
                    />
                    Lembrar meu acesso
                  </label>
                  <button
                    type="button"
                    onClick={handleForgot}
                    className="text-[#3b9df6] transition hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>

                <button type="submit" disabled={loading} className={submitBtn}>
                  {loading ? (
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <span className="flex-1 text-center">Entrar</span>
                      <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>
            ) : tab === "code" ? (
              <form onSubmit={otpSent ? handleOtp : sendCode} className="mt-6 space-y-4">
                <div className="space-y-2.5">
                  <label htmlFor="email-code" className="text-sm text-slate-200">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3b9df6]" />
                    <input
                      id="email-code"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Digite seu e-mail"
                      autoComplete="email"
                      required
                      className={fieldClass}
                    />
                  </div>
                </div>

                {otpSent && (
                  <div className="space-y-2.5">
                    <label htmlFor="otp" className="text-sm text-slate-200">
                      Código de verificação
                    </label>
                    <input
                      id="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      required
                      className="h-14 w-full rounded-xl border border-[#1b2c42] bg-[#0b1725] px-4 text-center text-lg tracking-[0.5em] text-slate-100 placeholder:text-slate-600 outline-none focus:border-[#2f8ef4] focus:ring-2 focus:ring-[#2f8ef4]/25"
                    />
                    <p className="text-xs text-slate-500">
                      Enviamos um código para <strong className="text-slate-300">{email}</strong>.
                      Verifique a caixa de entrada e o spam.
                    </p>
                  </div>
                )}

                <button type="submit" disabled={loading} className={submitBtn}>
                  {loading ? (
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <span className="flex-1 text-center">
                        {otpSent ? "Confirmar acesso" : "Enviar código"}
                      </span>
                      <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="mt-6 space-y-4">
                <div className="space-y-2.5">
                  <label htmlFor="full-name" className="text-sm text-slate-200">
                    Nome completo
                  </label>
                  <div className="relative">
                    <UserPlus className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3b9df6]" />
                    <input
                      id="full-name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Seu nome"
                      autoComplete="name"
                      required
                      maxLength={120}
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <label htmlFor="signup-email" className="text-sm text-slate-200">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3b9df6]" />
                    <input
                      id="signup-email"
                      type="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="Digite seu e-mail"
                      autoComplete="email"
                      required
                      maxLength={255}
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <label htmlFor="signup-password" className="text-sm text-slate-200">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3b9df6]" />
                    <input
                      id="signup-password"
                      type={showPassword ? "text" : "password"}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="Mínimo de 8 caracteres"
                      autoComplete="new-password"
                      required
                      className={fieldClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <label htmlFor="signup-confirm" className="text-sm text-slate-200">
                    Confirmar senha
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3b9df6]" />
                    <input
                      id="signup-confirm"
                      type={showPassword ? "text" : "password"}
                      value={signupConfirm}
                      onChange={(e) => setSignupConfirm(e.target.value)}
                      placeholder="Repita a senha"
                      autoComplete="new-password"
                      required
                      className={fieldClass}
                    />
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  Cadastro autorizado por convite. A conta criada recebe perfil{" "}
                  <strong className="text-[#3b9df6]">master admin</strong>, com acesso completo ao
                  painel.
                </p>

                <button type="submit" disabled={loading} className={submitBtn}>
                  {loading ? (
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <span className="flex-1 text-center">Criar conta e acessar</span>
                      <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>
            )}

            <p className="mt-6 text-center text-sm text-slate-400">
              {tab === "signup" ? (
                <>
                  Já tem uma conta?{" "}
                  <button
                    type="button"
                    onClick={() => setTab("login")}
                    className="font-medium text-[#3b9df6] transition hover:underline"
                  >
                    Entrar
                  </button>
                </>
              ) : inviteValid ? (
                <>
                  Convite validado.{" "}
                  <button
                    type="button"
                    onClick={() => setTab("signup")}
                    className="font-medium text-[#3b9df6] transition hover:underline"
                  >
                    Criar conta
                  </button>
                </>
              ) : (
                <span className="text-slate-500">
                  Acesso restrito. Novas contas somente por link de convite.
                </span>
              )}
            </p>

            <div className="mt-7 flex items-center gap-5">
              <span className="h-px flex-1 bg-[#152437]" />
              <BrandLogo inverse className="w-[96px]" />
              <span className="h-px flex-1 bg-[#152437]" />
            </div>

            <p className="mt-5 flex items-start justify-center gap-2 text-center text-[13px] leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#3b9df6]" />
              <span>
                Seus dados estão protegidos com
                <br />
                tecnologia de ponta e criptografia avançada.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
