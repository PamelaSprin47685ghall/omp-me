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
        let query;
        try {
            query = window.matchMedia('(prefers-color-scheme: dark)');
        } catch {
            return;
        }
        const handler = (e) => {
            setIsDark(e.matches);
            document.documentElement.classList.toggle(Classes.DARK, e.matches);
        };
        query.addEventListener('change', handler);
        return () => query.removeEventListener('change', handler);
    }, []);

    return { isDark };
}
