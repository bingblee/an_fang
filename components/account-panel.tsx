"use client";

import { ArrowLeft, Eye, EyeOff, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export function AccountPanel({ username }: { username: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const change = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmation) {
      setMessage({ text: "两次输入的新密码不一致。", error: true });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "密码暂时没有更新。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setMessage({ text: result.message || "密码已更新。", error: false });
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "密码暂时没有更新。", error: true });
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription) {
            await fetch("/api/push/subscribe", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: subscription.endpoint })
            });
          }
          await subscription?.unsubscribe();
        }
      } catch {
        // 服务端退出仍会移除与当前会话绑定的推送订阅。
      }
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("暂时没有退出，请重试。");
      window.location.replace("/login");
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : "暂时没有退出，请重试。");
      setLoggingOut(false);
    }
  };

  return (
    <main className="account-page">
      <header className="account-header">
        <Link href="/" className="account-back"><ArrowLeft size={16} /> 返回安放</Link>
        <ThemeToggle />
      </header>
      <section className="account-sheet">
        <div className="account-identity">
          <span className="account-monogram">{username.slice(0, 1).toLocaleUpperCase("zh-CN")}</span>
          <div><p>主人账号</p><h1>{username}</h1></div>
        </div>
        <div className="account-security-note"><ShieldCheck size={17} /><span>修改密码后，其他设备上的登录会立即失效。</span></div>
        <form className="account-form" onSubmit={change}>
          <div className="account-section-heading"><strong>修改密码</strong><span>使用一个只有你知道的新密码</span></div>
          <label className="auth-field"><span>当前密码</span><input type={showPassword ? "text" : "password"}
            value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password" required disabled={submitting} /></label>
          <label className="auth-field"><span>新密码</span><div className="password-input">
            <input type={showPassword ? "text" : "password"} value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password"
              minLength={10} maxLength={200} required disabled={submitting} placeholder="至少 10 位，含字母和数字" />
            <button type="button" onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"} tabIndex={-1}>
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div></label>
          <label className="auth-field"><span>确认新密码</span><input type={showPassword ? "text" : "password"}
            value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password" minLength={10} maxLength={200} required disabled={submitting} /></label>
          {message && <p className={`account-message ${message.error ? "error" : ""}`} role="status">{message.text}</p>}
          <button className="auth-submit account-save" type="submit" disabled={submitting}>
            {submitting && <LoaderCircle className="spin" size={17} />}{submitting ? "正在更新……" : "更新密码"}
          </button>
        </form>
        <div className="account-exit">
          <div><strong>结束当前登录</strong><span>这台设备需要重新输入密码才能进入。</span>
            {logoutError && <span className="account-exit-error" role="alert">{logoutError}</span>}
          </div>
          <button type="button" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? <LoaderCircle className="spin" size={16} /> : <LogOut size={16} />}
            {loggingOut ? "正在退出" : "退出登录"}
          </button>
        </div>
      </section>
    </main>
  );
}
