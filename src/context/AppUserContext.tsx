import { createContext, useContext } from "react";

const AppUserContext = createContext("");
export const AppUserProvider = AppUserContext.Provider;
export const useAppUserId = () => useContext(AppUserContext);
