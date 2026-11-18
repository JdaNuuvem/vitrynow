import { AuthRoot } from "@/features/auth/AuthRoot";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";

export default function Page() {
  return (
    <AuthRoot>
      <ForgotPasswordPage />
    </AuthRoot>
  );
}
