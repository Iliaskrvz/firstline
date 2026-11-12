import type { Metadata } from "next";
import { Card, Logo } from "@/components/ui";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">Reset your password</h1>
        <p className="mt-1 text-sm text-slate-500">We&apos;ll email you a link to choose a new one.</p>
        <ForgotForm />
      </Card>
    </div>
  );
}
