import { createContext, useContext, type ReactNode } from 'react';

const PrivacyCtx = createContext<boolean>(false);

export function PrivacyProvider({ hidden, children }: { hidden: boolean; children: ReactNode }) {
    return <PrivacyCtx.Provider value={hidden}>{children}</PrivacyCtx.Provider>;
}

export function usePrivacy(): boolean {
    return useContext(PrivacyCtx);
}

// Convenience: render either the value or a blurred placeholder.
export function Priv({ children }: { children: string }) {
    const hidden = usePrivacy();
    return hidden ? <span className="blur-sm select-none">{children}</span> : <>{children}</>;
}
