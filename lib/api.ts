// Base URL of the UrbanHeat Watch backend (backend/api). No third-party keys or credentials live
// in the app; OpenRouter, NASA GIBS and weather calls all happen server-side.
export const API_BASE_URL = (process.env.EXPO_PUBLIC_ECOWATCH_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
