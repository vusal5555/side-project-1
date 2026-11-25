import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import AuthShell from "@/components/auth/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell
      heading="Create your account"
      description="Get started with your hotel's reservation workspace."
    >
      <Suspense
        fallback={
          <div className="py-14 text-sm text-slate-500">Loading sign up...</div>
        }
      >
        <SignUp
          routing="path"
          path="/sign-up"
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
