import { LockKeyhole, LogIn, Mail, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  authConfigMessage,
  hasStaffAllowlist,
  hasSupabaseAuthConfig,
  isStaffEmail,
  normaliseNextPath,
  readDashboardAuthConfig,
} from "../../lib/auth";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = Array.isArray(params?.error) ? params.error[0] : params?.error;
  const next = normaliseNextPath(
    Array.isArray(params?.next) ? params.next[0] : params?.next ?? "/",
  );
  const config = readDashboardAuthConfig();
  const ready = hasStaffAllowlist(config) && hasSupabaseAuthConfig(config);

  return (
    <main className="loginShell">
      <section className="loginPanel" aria-labelledby="login-title">
        <div className="brandLockup">
          <span className="brandMark" aria-hidden="true">D</span>
          <span>
            <span className="brandName">DENTINO</span>
            <span className="brandSub">STAFF ACCESS</span>
          </span>
        </div>

        <div>
          <p className="eyebrow">Захищена панель</p>
          <h1 id="login-title">Вхід для персоналу</h1>
        </div>

        {!ready
          ? (
            <div className="validation invalid" data-testid="auth-config-error">
              <strong>
                <ShieldAlert
                  key="auth-config-icon"
                  size={18}
                  aria-hidden="true"
                />
                Auth не налаштовано
              </strong>
              <span>{authConfigMessage(config)}</span>
            </div>
          )
          : null}

        {error
          ? (
            <div className="validation invalid" data-testid="login-error">
              <strong>Вхід відхилено</strong>
              <span>{loginErrorMessage(error)}</span>
            </div>
          )
          : null}

        <form className="formStack" action={loginAction}>
          <input key="next-path" type="hidden" name="next" value={next} />
          <label>
            Email
            <span className="inputWithIcon">
              <Mail key="email-icon" size={18} aria-hidden="true" />
              <input
                key="email-input"
                autoComplete="email"
                disabled={!ready}
                name="email"
                required
                type="email"
              />
            </span>
          </label>
          <label>
            Пароль
            <span className="inputWithIcon">
              <LockKeyhole key="password-icon" size={18} aria-hidden="true" />
              <input
                key="password-input"
                autoComplete="current-password"
                disabled={!ready}
                name="password"
                required
                type="password"
              />
            </span>
          </label>
          <button className="button" disabled={!ready} type="submit">
            <LogIn key="login-icon" size={18} aria-hidden="true" />
            Увійти
          </button>
        </form>
      </section>
    </main>
  );
}

async function loginAction(formData: FormData) {
  "use server";

  const config = readDashboardAuthConfig();
  const next = normaliseNextPath(formData.get("next"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!hasStaffAllowlist(config) || !hasSupabaseAuthConfig(config)) {
    redirect(loginRedirect("config", next));
  }
  if (!isStaffEmail(email, config)) {
    redirect(loginRedirect("staff", next));
  }

  const cookieStore = await cookies();
  const { createServerClient } = await import("@supabase/ssr");
  const supabase = createServerClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    redirect(loginRedirect("login_failed", next));
  }

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !isStaffEmail(data.user.email, config)) {
    await supabase.auth.signOut();
    redirect(loginRedirect("staff", next));
  }

  redirect(next as Route);
}

function loginErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    config: "Панель ще не має Supabase Auth конфігурації.",
    login_failed: "Перевірте email і пароль.",
    staff: "Email не входить до allowlist персоналу.",
  };
  return messages[error] ?? "Спробуйте ще раз.";
}

function loginRedirect(error: string, next: string): Route {
  return `/login?error=${error}&next=${encodeURIComponent(next)}` as Route;
}
