import { PlatformShell } from "@/features/plataforma/PlatformShell";

export default function PlatformInternalLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
