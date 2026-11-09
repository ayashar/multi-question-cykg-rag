import type { Metadata } from "next";
import { AuthForm } from "@/modules/auth/components/auth-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the ChatBot CSKG investigation dashboard.",
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

const callbackErrors: Record<string, string> = {
  auth_callback_failed:
    "The verification link is invalid or has expired. Please sign up again.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <AuthForm
      mode="login"
      nextPath={params.next}
      callbackError={params.error ? callbackErrors[params.error] : undefined}
    />
  );
}
