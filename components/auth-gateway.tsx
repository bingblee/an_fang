"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, UserRoundPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthMode = "login" | "register" | "setup" | "recover";

export function AuthGateway({
  mode,
  nextPath = "/",
  setupConfigured = true
}: {
  mode: AuthMode;
  nextPath?: string;
  setupConfigured?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = mode === "setup";
  const register = mode === "register";
  const recovery = mode === "recover";
  const needsToken = setup || recovery;
  const needsConfirmation = setup || register || recovery;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || (needsToken && !setupConfigured)) return;
    if (needsConfirmation && password !== confirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember, ...(needsToken ? { setupToken } : {}) })
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || "暂时无法进入，请稍后再试。");
      window.location.replace(nextPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法进入，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-theme"><ThemeToggle /></div>
      <section className="auth-threshold" aria-labelledby="auth-title">
        <div className="auth-intro">
          <a className="brand auth-brand" href={setup ? "/setup" : register ? "/register" : recovery ? "/recover" : "/login"} aria-label="安放">
            <span className="brand-stamp">安</span>
            <span className="brand-copy"><strong>安放</strong><small>LIFE NAVIGATOR</small></span>
          </a>
          <div className="auth-intro-copy">
            <h1 id="auth-title">{setup ? "先把这扇门交给你" : register ? "给自己留一处安放" : recovery ? "重新拿回这把钥匙" : "回到你的安放之处"}</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-heading">
            <span className="auth-key-mark">{register ? <UserRoundPlus size={18} /> : <KeyRound size={18} />}</span>
            <strong>{setup ? "首次设置" : register ? "创建账号" : recovery ? "重置密码" : "账号登录"}</strong>
          </div>

          {!setupConfigured && (
            <div className="auth-config-warning" role="alert">
              服务器缺少 AUTH_SETUP_TOKEN，请先在环境变量中配置至少 20 位的首次设置口令。
            </div>
          )}

          {needsToken && (
            <label className="auth-field">
              <span>首次设置口令</span>
              <input value={setupToken} onChange={(event) => setSetupToken(event.target.value)}
                autoComplete="one-time-code" required disabled={!setupConfigured || submitting}
                placeholder="由服务器配置提供" autoFocus />
            </label>
          )}

          <label className="auth-field">
            <span>用户名</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)}
              autoComplete="username" autoCapitalize="none" required disabled={submitting}
              minLength={2} maxLength={40} placeholder="你的称呼" autoFocus={!needsToken} />
          </label>

          <label className="auth-field">
              <span>{recovery ? "新密码" : "密码"}</span>
            <div className="password-input">
              <input type={showPassword ? "text" : "password"} value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={needsConfirmation ? "new-password" : "current-password"} required
                minLength={needsConfirmation ? 10 : 1} maxLength={200} disabled={submitting}
                placeholder={needsConfirmation ? "至少 10 位，含字母和数字" : "输入密码"} />
              <button type="button" onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"} tabIndex={-1}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          {needsConfirmation && (
            <label className="auth-field">
              <span>{recovery ? "确认新密码" : "确认密码"}</span>
              <input type={showPassword ? "text" : "password"} value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password" required minLength={10} maxLength={200}
                disabled={submitting} placeholder="再输入一次" />
            </label>
          )}

          <label className="remember-choice">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <strong>记住登录 30 天</strong>
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={submitting || (needsToken && !setupConfigured)}>
            {submitting ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}
            {submitting ? "正在确认……" : setup || register ? "创建并进入" : recovery ? "重置并进入" : "进入安放"}
          </button>
          {mode === "login" && <p className="auth-recovery auth-entry-links"><a href="/register">创建账号</a><span>·</span><a href="/recover">忘记密码</a></p>}
          {register && <p className="auth-recovery"><a href="/login">已有账号，返回登录</a></p>}
          {recovery && <p className="auth-recovery"><a href="/login">返回登录</a></p>}
        </form>
      </section>
    </main>
  );
}
