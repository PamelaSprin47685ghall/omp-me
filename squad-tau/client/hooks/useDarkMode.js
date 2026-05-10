import { useState, useEffect } from 'react';
import { Classes } from '@blueprintjs/core';

export function useDarkMode() {
    const [isDark, setIsDark] = useState(() => {
        const matches = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle(Classes.DARK, matches);
        return matches;
    });

    useEffect(() => {
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e) => {
            setIsDark(e.matches);
            document.documentElement.classList.toggle(Classes.DARK, e.matches);
        };
        query.addEventListener('change', handler);
        return () => query.removeEventListener('change', handler);
    }, []);

    return { isDark };
}
