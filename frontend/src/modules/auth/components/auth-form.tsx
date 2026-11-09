"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { CskgLogo } from "@/components/ui/cskg-logo";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { setActiveAccountId } from "@/lib/supabase/investigation-store";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  mode: AuthMode;
  nextPath?: string;
  callbackError?: string;
}

function safeNextPath(value?: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function authErrorMessage(message: string) {
  if (/invalid login credentials/i.test(message)) {
    return "Invalid email or password.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Your email has not been verified. Open the Supabase verification email and follow the confirmation link.";
  }
  if (/user already registered/i.test(message)) {
    return "This email is already registered. Please sign in.";
  }
  if (/password should be|weak password/i.test(message)) {
    return "The password does not meet the security requirements.";
  }
  if (/rate limit/i.test(message)) {
    return "Too many attempts. Wait a moment, then try again.";
  }
  return message || "Something went wrong. Please try again.";
}

function Field({
  id,
  label,
  icon: Icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-semibold text-neutral-1000">
        {label}
      </span>
      <span className="relative block">
        <Icon className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-neutral-600" />
        <input
          id={id}
          className="h-12 w-full rounded-lg border border-neutral-300 bg-white pl-11 pr-4 text-sm text-neutral-1000 outline-none transition placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-500 focus:ring-4 focus:ring-primary-100/70 disabled:cursor-not-allowed disabled:bg-neutral-100"
          {...props}
        />
      </span>
    </label>
  );
}

export function AuthForm({ mode, nextPath, callbackError }: AuthFormProps) {
  const isLogin = mode === "login";
  const configured = isSupabaseConfigured();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(callbackError ?? "");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!configured) {
      setError("Supabase is not configured. Add the required values to frontend/.env.local.");
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    if (!isLogin && password.length < 8) {
      setError("The password must be at least 8 characters long.");
      return;
    }

    setPending(true);

    try {
      const supabase = createClient();

      if (isLogin) {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) throw signInError;
        if (data.user) setActiveAccountId(data.user.id);
        window.location.assign(safeNextPath(nextPath));
        return;
      }

      const redirectPath = safeNextPath(nextPath);
      const redirectUrl = new URL("/auth/confirm", window.location.origin);
      redirectUrl.searchParams.set("next", redirectPath);

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectUrl.toString(),
          data: { full_name: fullName.trim() },
        },
      });

      if (signUpError) throw signUpError;

      if (data.session) {
        if (data.user) setActiveAccountId(data.user.id);
        window.location.assign(redirectPath);
        return;
      }

      setSuccess(
        "Your account has been created. Check your inbox or spam folder to verify your email.",
      );
      setPassword("");
      setConfirmPassword("");
    } catch (caughtError) {
      setError(
        authErrorMessage(
          caughtError instanceof Error ? caughtError.message : "Something went wrong.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f8f6fa]">
      <div className="pointer-events-none absolute -left-32 -top-32 size-[420px] rounded-full bg-primary-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 size-[460px] rounded-full bg-blue-100/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-[1440px] items-stretch p-4 sm:p-6 lg:p-8">
        <section className="hidden w-[46%] flex-col overflow-hidden rounded-l-2xl bg-primary-900 p-10 text-white lg:flex xl:p-14">
          <div className="flex items-center gap-3">
            <CskgLogo />
            <div>
              <p className="text-base font-bold tracking-tight">ChatBot CSKG</p>
              <p className="text-xs text-primary-200">Cybersecurity Knowledge Graph</p>
            </div>
          </div>

          <div className="my-auto max-w-md">
            <p className="mb-4 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-primary-100 ring-1 ring-white/10">
              Secure investigation workspace
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-[-0.03em] xl:text-5xl">
              Investigate incidents with complete context.
            </h1>
            <p className="mt-5 max-w-sm text-base leading-7 text-primary-200">
              Bring alerts, attack graphs, and investigation findings together in one secure workspace.
            </p>
          </div>

        </section>

        <section className="flex flex-1 items-center justify-center rounded-2xl bg-white px-5 py-10 shadow-[0_24px_80px_rgba(50,32,61,0.12)] lg:rounded-l-none sm:px-10">
          <div className="w-full max-w-[430px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <CskgLogo className="size-10" />
              <span className="font-bold text-primary-900">ChatBot CSKG</span>
            </div>

            <p className="text-sm font-semibold text-primary-700">
              {isLogin ? "WELCOME BACK" : "CREATE A NEW ACCOUNT"}
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-[-0.025em] text-neutral-1000">
              {isLogin ? "Sign in to your account" : "Start investigating"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-700">
              {isLogin
                ? "Use the email and password registered to your account."
                : "Sign up to access the security investigation dashboard."}
            </p>

            {!configured && (
              <div className="mt-6 flex gap-3 rounded-lg border border-yellow-300 bg-yellow-100/40 p-3 text-sm leading-5 text-yellow-500">
                <AlertCircle className="mt-0.5 size-5 shrink-0" />
                <p>
                  Supabase is not connected. Copy <code>.env.example</code> to{" "}
                  <code>.env.local</code>, then add the project URL and publishable key.
                </p>
              </div>
            )}

            {error && (
              <div role="alert" className="mt-6 flex gap-3 rounded-lg border border-red-100 bg-red-100/20 p-3 text-sm leading-5 text-red-400">
                <AlertCircle className="mt-0.5 size-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {success && (
              <div role="status" className="mt-6 flex gap-3 rounded-lg border border-green-200 bg-green-100/25 p-3 text-sm leading-5 text-green-500">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
                <p>{success}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              {!isLogin && (
                <Field
                  id="full-name"
                  label="Full name"
                  icon={UserRound}
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder="Your full name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  minLength={2}
                  required
                  disabled={pending}
                />
              )}

              <Field
                id="email"
                label="Email"
                icon={Mail}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={pending}
              />

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-semibold text-neutral-1000">
                  Password
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-neutral-600" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    placeholder={isLogin ? "Enter your password" : "At least 8 characters"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={isLogin ? undefined : 8}
                    required
                    disabled={pending}
                    className="h-12 w-full rounded-lg border border-neutral-300 bg-white pl-11 pr-12 text-sm text-neutral-1000 outline-none transition placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-500 focus:ring-4 focus:ring-primary-100/70 disabled:cursor-not-allowed disabled:bg-neutral-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-1000"
                  >
                    {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                  </button>
                </div>
              </div>

              {!isLogin && (
                <Field
                  id="confirm-password"
                  label="Confirm password"
                  icon={LockKeyhole}
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  required
                  disabled={pending}
                />
              )}

              <button
                type="submit"
                disabled={pending || !configured}
                className="group flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-800 px-5 text-sm font-bold text-white transition hover:bg-primary-900 focus:outline-none focus:ring-4 focus:ring-primary-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : (
                  <>
                    {isLogin ? "Sign in" : "Create account"}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-neutral-700">
              {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
              <Link
                href={isLogin ? "/signup" : "/login"}
                className="font-bold text-primary-700 hover:text-primary-900 hover:underline"
              >
                {isLogin ? "Sign up now" : "Sign in"}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
