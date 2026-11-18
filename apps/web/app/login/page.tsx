import { AuthRoot } from "@/features/auth/AuthRoot";
import { LoginPage } from "@/features/auth/LoginPage";

export default function Page() {
  return (
    <AuthRoot>
      <LoginPage />
    </AuthRoot>
  );
}
