import { createContext, useContext } from "react";
import type { PlatformAccess } from "@/lib/platform-access";

const AccessContext = createContext<PlatformAccess>({ isAdmin: false, companies: [], securityReady: false });
export const PlatformAccessProvider = AccessContext.Provider;
export const usePlatformAccess = () => useContext(AccessContext);
