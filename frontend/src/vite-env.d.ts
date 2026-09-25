/// <reference types="vite/client" />
declare const __BUILD__: string;
interface ImportMetaEnv {
  readonly VITE_STATIC?: string;
}
declare module "virtual:static-bundle" {
  const bundle: Record<string, unknown>;
  export default bundle;
}
