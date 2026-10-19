import { createContext, useContext, useState, ReactNode } from "react";
import { ASEAN_CITIES, City } from "./aseanCities";
 
 const CityContext = createContext<{ city: City; setCity: (c: City) => void } | null>(null);

   export function CityProvider({ children }: { children: ReactNode }) {
    
    const [city, setCity] = useState<City>(ASEAN_CITIES[0]);
    
     return <CityContext.Provider value={{ city, setCity }}>{children}</CityContext.Provider>;
   }

   export function useCity() {
     const ctx = useContext(CityContext);
     if (!ctx) throw new Error("useCity must be used inside CityProvider");
     return ctx;
   }