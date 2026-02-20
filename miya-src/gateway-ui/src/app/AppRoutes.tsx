import type { ReactNode } from 'react';

interface AppRoutesProps {
  children: ReactNode;
}

export function AppRoutes(props: AppRoutesProps) {
  return <>{props.children}</>;
}
