"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearActiveAccountId } from "@/lib/supabase/investigation-store";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleLogout() {
    setPending(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "local",
      });

      if (signOutError) throw signOutError;

      clearActiveAccountId();
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Could not sign out. Try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        aria-label="Log Out"
        title="Log Out"
        onClick={handleLogout}
        disabled={pending}
        className="group flex h-11 w-full cursor-pointer items-center gap-2 rounded-[3px] border-l-2 border-transparent px-[18px] py-2.5 text-left text-sm font-medium text-red-300 transition-all duration-150 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? (
          <LoaderCircle className="size-5 shrink-0 animate-spin" />
        ) : (
          <LogOut className="size-5 shrink-0 text-red-300" />
        )}
        <span className="hidden lg:block">{pending ? "Signing out..." : "Log Out"}</span>
      </button>
      {error && (
        <p role="alert" className="hidden px-[18px] pt-1 text-xs text-red-400 lg:block">
          {error}
        </p>
      )}
    </div>
  );
}
