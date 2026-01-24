import React, { useMemo, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@dialectlabs/react-ui/index.css';
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';
import { NotificationsButton } from '@dialectlabs/react-ui';
import { PublicKey } from '@solana/web3.js';

// Our dapp's public key (derived from DIALECT_PRIVATE_KEY)
const DAPP_ADDRESS = '2Q6KaLBTAJD6gbwqEQh9knBx2KhHTxuH4zLWbF9BYgdo';

// Wrapper component that provides the wallet context to Dialect
const DialectNotifications = () => {
    const [walletAddr, setWalletAddr] = useState(null);
    const [provider, setProvider] = useState(null);

    useEffect(() => {
        const checkWallet = () => {
            const addr = window.connectedWallet;
            const prov = window.connectedProvider;

            if (addr !== walletAddr) setWalletAddr(addr);
            if (prov !== provider) setProvider(prov);
        };

        checkWallet();
        const interval = setInterval(checkWallet, 500);
        return () => clearInterval(interval);
    }, [walletAddr, provider]);

    // Create wallet adapter using useMemo as per Dialect docs
    const walletAdapter = useMemo(() => {
        if (!walletAddr || !provider) return null;

        return {
            publicKey: new PublicKey(walletAddr),
            signMessage: async (message) => {
                if (provider.signMessage) {
                    return await provider.signMessage(message);
                }
                throw new Error('Wallet does not support message signing');
            },
            signTransaction: async (tx) => {
                if (provider.signTransaction) {
                    return await provider.signTransaction(tx);
                }
                throw new Error('Wallet does not support transaction signing');
            },
        };
    }, [walletAddr, provider]);

    // Don't render until wallet is connected
    if (!walletAdapter) return null;

    return (
        <DialectSolanaSdk
            dappAddress={DAPP_ADDRESS}
            customWalletAdapter={walletAdapter}
            config={{
                environment: 'production',
            }}
        >
            <NotificationsButton
                theme="dark"
                channels={['telegram']}
            />
        </DialectSolanaSdk>
    );
};

export function mountDialectNotifications(id) {
    const el = document.getElementById(id);
    if (el && !el._dialectRoot) {
        const root = createRoot(el);
        el._dialectRoot = root;
        root.render(<DialectNotifications />);
        return root;
    }
    return null;
}

if (typeof window !== 'undefined') {
    window.mountDialectNotifications = mountDialectNotifications;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => mountDialectNotifications('dialect-notifications-root'));
    } else {
        setTimeout(() => mountDialectNotifications('dialect-notifications-root'), 100);
    }
}

export default DialectNotifications;
