/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css';

declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export function createRoot(container: Element | null): {
    render(children: ReactNode): void;
    unmount(): void;
  };
}
