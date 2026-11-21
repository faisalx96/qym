import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ExplanationLanguage = 'en' | 'ar' | 'both';
export const explanationLanguageKey = 'qym:live-explanation-language';

const ExplanationLanguageContext = createContext<{
  language: ExplanationLanguage;
  setLanguage: (language: ExplanationLanguage) => void;
}>({ language: 'en', setLanguage: () => {} });

function storedLanguage(): ExplanationLanguage {
  try {
    const value = localStorage.getItem(explanationLanguageKey);
    if (value === 'en' || value === 'ar' || value === 'both') return value;
  } catch {
    // Storage may be unavailable; the preference still works for this page visit.
  }
  return 'en';
}

export function ExplanationLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setValue] = useState(storedLanguage);
  const setLanguage = useCallback((value: ExplanationLanguage) => {
    setValue(value);
    try {
      localStorage.setItem(explanationLanguageKey, value);
    } catch {
      // Keep the in-memory choice when the browser cannot persist it.
    }
  }, []);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <ExplanationLanguageContext.Provider value={value}>{children}</ExplanationLanguageContext.Provider>;
}

export function useExplanationLanguage() {
  return useContext(ExplanationLanguageContext);
}
