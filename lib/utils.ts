import { PRE_PROD_ENVIRONMENT_SUFFIX } from "./constants"

// Define base domain
const BASE_DOMAIN = process.env.BAAS_URL || "meetingbaas.com"

// Helper to construct environment-aware API URL
export const getApiUrl = (environment: string | null) => {
  if (environment && environment === PRE_PROD_ENVIRONMENT_SUFFIX) {
    return `https://api.${environment}${BASE_DOMAIN}`
  }
  return `https://api.${BASE_DOMAIN}`
}
