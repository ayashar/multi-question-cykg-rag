import type { Metadata } from "next";
import { AuthForm } from "@/modules/auth/components/auth-form";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a ChatBot CSKG account.",
};

interface SignupPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  return <AuthForm mode="signup" nextPath={params.next} />;
}
