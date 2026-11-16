import { Suspense } from "react";
import { AuthRoot } from "@/features/auth/AuthRoot";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";

export default function Page() {
  return (
    <AuthRoot>
      <Suspense>
        <ResetPasswordPage />
      </Suspense>
    </AuthRoot>
  );
}
