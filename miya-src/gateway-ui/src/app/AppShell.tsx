import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  return <>{props.children}</>;
}
