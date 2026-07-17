/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_TENANT_ID?: string;
  // Optional bearer token for the real API (default unset; the demo never sets it).
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
