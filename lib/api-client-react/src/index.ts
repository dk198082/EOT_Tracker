export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  ROLE_SIMULATION_HEADER,
  ROLE_SIMULATION_STORAGE_KEY,
  setBaseUrl,
  setAuthTokenGetter,
} from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
