import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage, withAuthTimeout } from "@/lib/auth-request";
import { BrandLogo } from "@/components/common/BrandLogo";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Recuperar acesso — Modblue Controladoria" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    withAuthTimeout(supabase.auth.getSession()).then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      setReady(Boolean(data.session));
      if (!data.session) setError("Abra o link enviado ao seu e-mail. Se ele expirou, solicite outro na tela de entrada.");
    }).catch(error => { if (active) setError(authErrorMessage(error)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    if (password.length < 8) { setError("Use uma senha com pelo menos 8 caracteres."); return; }
    if (password !== confirmation) { setError("As senhas precisam ser iguais."); return; }
    setBusy(true); setError("");
    try {
      const { error } = await withAuthTimeout(supabase.auth.updateUser({ password }));
      if (error) throw error;
      await navigate({ to: "/", replace: true });
    } catch (error) { setError(authErrorMessage(error)); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-[100svh] items-center justify-center bg-[#04080f] px-5 text-slate-200">
    <section className="w-full max-w-md rounded-2xl border border-[#152437] bg-[#070f1a] p-8">
      <BrandLogo inverse className="mx-auto w-44" />
      <h1 className="mt-7 text-xl font-medium text-white">Recuperar acesso</h1>
      <p className="mt-2 text-sm text-slate-400">Defina sua nova senha para entrar na Controladoria.</p>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      {checking ? <p role="status" className="mt-6">Conferindo seu link...</p> : ready && <form onSubmit={save} className="mt-6 space-y-4">
        <label className="block text-sm">Nova senha<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-[#1b2c42] bg-[#0b1725] px-4" /></label>
        <label className="block text-sm">Confirmar nova senha<input type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-[#1b2c42] bg-[#0b1725] px-4" /></label>
        <button type="submit" disabled={busy} className="h-12 w-full rounded-xl bg-[#0b63d6] text-sm font-semibold text-white disabled:opacity-60">{busy ? "Salvando..." : "Salvar senha e acessar"}</button>
      </form>}
      <Link to="/login" className="mt-6 inline-block text-sm text-[#3b9df6]">Voltar para a entrada</Link>
    </section>
  </main>;
}
