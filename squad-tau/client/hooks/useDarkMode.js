import { useState, useEffect } from 'react';
import { Classes } from '@blueprintjs/core';

export function useDarkMode() {
    const [isDark, setIsDark] = useState(() => {
        if (typeof window === 'undefined') return false;
        try {
            const matches = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.classList.toggle(Classes.DARK, matches);
            return matches;
        } catch {
            return false;
        }
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        document.documentElement.classList.toggle(Classes.DARK, isDark);
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
            document.documentElement.classList.remove(Classes.DARK);
        };
    }, []);

    return { isDark };
}
