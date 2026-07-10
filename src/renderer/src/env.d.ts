/// <reference types="vite/client" />

declare module '@fontsource-variable/plus-jakarta-sans';

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
