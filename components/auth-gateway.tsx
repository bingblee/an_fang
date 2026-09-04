"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthMode = "login" | "setup" | "recover";

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
  const recovery = mode === "recover";
  const needsToken = setup || recovery;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || (needsToken && !setupConfigured)) return;
    if (needsToken && password !== confirmation) {
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
          <a className="brand auth-brand" href={setup ? "/setup" : recovery ? "/recover" : "/login"} aria-label="安放">
            <span className="brand-stamp">安</span>
            <span className="brand-copy"><strong>安放</strong><small>LIFE NAVIGATOR</small></span>
          </a>
          <div className="auth-intro-copy">
            <p className="auth-kicker">PRIVATE SPACE / 私人空间</p>
            <h1 id="auth-title">{setup ? "先把这扇门交给你" : recovery ? "重新拿回这把钥匙" : "回到你的安放之处"}</h1>
            <p>{setup ? "创建唯一的主人账号。之后，事项、笔记与生活线索只在登录后出现。" : recovery ? "使用服务器上的首次设置口令，为主人账号换一个新密码。" : "你留下的每件小事，都还安静地待在原处。"}</p>
          </div>
          <div className="auth-privacy-note">
            <ShieldCheck size={17} />
            <span>密码不会被原文保存；登录凭证仅存于这台浏览器的安全 Cookie。</span>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-heading">
            <span className="auth-key-mark"><KeyRound size={18} /></span>
            <div><strong>{setup ? "首次设置" : recovery ? "重置密码" : "主人登录"}</strong><small>{setup ? "只需要完成一次" : recovery ? "撤销原有登录" : "仅你可进入"}</small></div>
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
              <small>{recovery ? "由服务器管理员临时重新配置，用完即可移除。" : "它只用于确认第一次建号，不是以后登录的密码。"}</small>
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
                autoComplete={needsToken ? "new-password" : "current-password"} required
                minLength={needsToken ? 10 : 1} maxLength={200} disabled={submitting}
                placeholder={needsToken ? "至少 10 位，含字母和数字" : "输入密码"} />
              <button type="button" onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"} tabIndex={-1}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          {needsToken && (
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
            <span><strong>记住登录</strong><small>在这台设备上保持 30 天</small></span>
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={submitting || (needsToken && !setupConfigured)}>
            {submitting ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}
            {submitting ? "正在确认……" : setup ? "创建并进入" : recovery ? "重置并进入" : "进入安放"}
          </button>
          {!needsToken && <p className="auth-recovery"><a href="/recover">忘记密码</a><span> · 使用服务器设置口令重置</span></p>}
          {recovery && <p className="auth-recovery"><a href="/login">返回登录</a></p>}
        </form>
      </section>
    </main>
  );
}
