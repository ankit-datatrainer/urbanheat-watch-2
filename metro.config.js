// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// The backend (Node API + Python worker with its virtualenv) is not part of the app bundle.
// The app only uses type-only imports from backend/api/src/types.ts, erased at build time.
const dirPattern = (...segments) => {
  const escaped = path
    .join(__dirname, ...segments)
    .split(/[\\/]/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\\\/]");
  return new RegExp(`^${escaped}[\\\\/].*`);
};

config.resolver.blockList = [dirPattern("backend", "worker"), dirPattern("backend", "api", "node_modules")];

module.exports = config;
