import { AuthRoot } from "@/features/auth/AuthRoot";
import { RegisterPage } from "@/features/auth/RegisterPage";

export default function Page() {
  return <AuthRoot><RegisterPage /></AuthRoot>;
}
