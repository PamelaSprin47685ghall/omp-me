import { useState, useEffect } from 'react';

export function useDarkMode() {
    const [isDark, setIsDark] = useState(() => {
        if (typeof window === 'undefined') return false;
        try {
            const matches = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.classList.toggle('bp6-dark', matches);
            return matches;
        } catch {
            return false;
        }
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        document.documentElement.classList.toggle('bp6-dark', isDark);
    }, [isDark]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        let query;
        try {
            query = window.matchMedia('(prefers-color-scheme: dark)');
        } catch {
            return;
        }
        const handler = (e) => {
            setIsDark(e.matches);
        };
        query.addEventListener('change', handler);
        return () => {
            query.removeEventListener('change', handler);
            document.documentElement.classList.remove('bp6-dark');
        };
    }, []);

    return { isDark };
}
