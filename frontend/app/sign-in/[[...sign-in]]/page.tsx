import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import AuthShell from "@/components/auth/auth-shell";

export default function SignInPage() {
  return (
    <AuthShell
      heading="Welcome back"
      description="Sign in to your hotel reservations workspace."
    >
      <Suspense
        fallback={
          <div className="py-14 text-sm text-slate-500">Loading sign in...</div>
        }
      >
        <SignIn
          routing="path"
          path="/sign-in"
          appearance={{
            variables: {
              colorPrimary: "#246d77",
              borderRadius: "0.75rem",
            },
          }}
        />
      </Suspense>
    </AuthShell>
  );
}
