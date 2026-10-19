import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PlaceService } from "./places.js";
import { WorkerClient } from "./satellite.js";
import { NeaWbgtProvider, OpenMeteoProvider } from "./weather.js";

const config = loadConfig();
const app = buildApp({
  config,
  places: new PlaceService(),
  weather: new OpenMeteoProvider(config.weatherCacheTtlMs, config.weatherStaleAfterMs),
  wbgt: new NeaWbgtProvider(),
  satellite: new WorkerClient(config.workerUrl, config.workerToken),
});

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
