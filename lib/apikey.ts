const KEY = "rotafolio_gemini_key";

export const getApiKey = (): string => {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEY) ?? "";
};

export const setApiKey = (k: string) => localStorage.setItem(KEY, k);
export const clearApiKey = () => localStorage.removeItem(KEY);
export const maskApiKey = (k: string) =>
  k.length < 8 ? "••••" : k.slice(0, 6) + "••••" + k.slice(-4);
export const pareceKeyValida = (k: string) => k.startsWith("AIza");
