import { Activity } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
            <Activity className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Kinetico M&amp;A</h1>
            <p className="text-sm text-muted-foreground">
              Pipeline &amp; deal management
            </p>
          </div>
        </div>
        <LoginForm />
        <div className="mt-6 rounded-lg border bg-card p-4 text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Demo logins</p>
          <ul className="space-y-1 font-mono">
            <li>admin@kinetico.test — admin</li>
            <li>lead@kinetico.test — deal lead</li>
            <li>exec@kinetico.test — exec</li>
            <li>viewer@kinetico.test — viewer (2 deals)</li>
          </ul>
          <p className="mt-2">
            Password for all: <span className="font-mono">KineticoDemo1!</span>
          </p>
        </div>
      </div>
    </div>
  );
}
