import { createContext, useContext, useState, ReactNode } from "react";
import { ASEAN_CITIES, City } from "./aseanCities";

/** The app opens on Jakarta, a large developing-nation city where heat risk is high. */
export const DEFAULT_CITY = ASEAN_CITIES.find((c) => c.id === "jkt") ?? ASEAN_CITIES[0]!;

const CityContext = createContext<{ city: City; setCity: (c: City) => void } | null>(null);

export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setCity] = useState<City>(DEFAULT_CITY);

  return <CityContext.Provider value={{ city, setCity }}>{children}</CityContext.Provider>;
}

export function useCity() {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error("useCity must be used inside CityProvider");
  return ctx;
}
