/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_DEFAULT_CASE_ID?: string;
  readonly PUBLIC_LIVE_MODE?: string;
  readonly PUBLIC_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
