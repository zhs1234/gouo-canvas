/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_GOUO_BACKEND_URL?: string
  readonly VITE_GOUO_BACKEND_DEV_TARGET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
