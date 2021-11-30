// Shim for Vue composition API
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  export default component;
}

// Shims for environment variables
interface ImportMeta {
  env: {
    VITE_BLOCKNATIVE_API_KEY: string;
    VITE_ALCHEMY_API_KEY: string;
    VITE_FLEEK_STORAGE_API_KEY: string;
    VITE_DGRANTS_CHAIN_ID: string;
    VITE_GRANT_WHITELIST_URI: string;
    VITE_MAINTENANCE_MODE?: string;
    VITE_GRANT_REGISTRY_CONTRACT?: string;
    VITE_GRANT_ROUND_MANAGER?: string;
    VITE_DEFAULT_RPC_URL?: string;
    VITE_SUBGRAPH_URL?: string;
    VITE_START_BLOCK?: string;
  };
}
