import { useState, useEffect, useCallback, useRef } from 'react';

export function useAutoScroll(containerRef, messages, deltas) {
    const [isAtBottom, setIsAtBottom] = useState(true);
    const rafIdRef = useRef(null);

    const checkIfAtBottom = useCallback(() => {
        if (!containerRef.current) return false;
        const { scrollTop, clientHeight, scrollHeight } = containerRef.current;
        return scrollTop + clientHeight >= scrollHeight - 100;
    }, [containerRef]);

    const scrollToBottom = useCallback(() => {
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
        }
        rafIdRef.current = requestAnimationFrame(() => {
            if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
                setIsAtBottom(true);
            }
            rafIdRef.current = null;
        });
    }, [containerRef]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const atBottom = checkIfAtBottom();
            setIsAtBottom(atBottom);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, [containerRef, checkIfAtBottom]);

    useEffect(() => {
        if (isAtBottom) {
            scrollToBottom();
        }
    }, [isAtBottom, scrollToBottom, messages, deltas]);

    return { isAtBottom, scrollToBottom };
}
