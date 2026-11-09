import type { Metadata } from "next";
import { AuthForm } from "@/modules/auth/components/auth-form";

export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk ke dashboard investigasi ChatBot CSKG.",
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

const callbackErrors: Record<string, string> = {
  auth_callback_failed:
    "Tautan verifikasi tidak valid atau sudah kedaluwarsa. Silakan daftar ulang.",
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
