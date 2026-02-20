import type { ReactNode } from 'react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';

interface AppProvidersProps {
  children: ReactNode;
  isHappyDomRuntime: () => boolean;
  inferRouterBasename: (pathname: string) => string;
}

export function AppProviders(props: AppProvidersProps) {
  if (props.isHappyDomRuntime()) {
    const initialEntry = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return (
      <MemoryRouter initialEntries={[initialEntry || '/']}>
        {props.children}
      </MemoryRouter>
    );
  }
  return (
    <BrowserRouter basename={props.inferRouterBasename(window.location.pathname)}>
      {props.children}
    </BrowserRouter>
  );
}
