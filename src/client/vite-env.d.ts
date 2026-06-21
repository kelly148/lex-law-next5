// WHEREAS-POLISH-1: type the client-only build-time env. Vite exposes only `VITE_`-prefixed vars to the
// client bundle, so the shader-polish flag is read as import.meta.env.VITE_UI_SHADER_POLISH_ENABLED.
// (We declare ImportMetaEnv/ImportMeta directly rather than `/// <reference types="vite/client" />` so we
// don't pull in Vite's global WindowEventMap augmentation, which conflicts with main.tsx's own
// 'vite:preloadError' declaration.)
interface ImportMetaEnv {
  readonly VITE_UI_SHADER_POLISH_ENABLED?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
