import { useState, useEffect, useCallback, useRef } from 'react';
import { streamingManager } from '../streaming-manager.js';

export function useAutoScroll(containerRef, messages) {
    const [isAtBottom, setIsAtBottom] = useState(true);
    const rafIdRef = useRef(null);

    const checkIfAtBottom = useCallback(() => {
        if (!containerRef.current) return false;
        const { scrollTop, clientHeight, scrollHeight } = containerRef.current;
        return scrollTop + clientHeight >= scrollHeight - 40;
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

    // Handle durable message changes
    useEffect(() => {
        if (isAtBottom) {
            scrollToBottom();
        }
    }, [isAtBottom, scrollToBottom, messages]);

    // Handle high-frequency deltas
    useEffect(() => {
        if (!isAtBottom) return;
        const wrapper = () => scrollToBottom();
        streamingManager.events.addEventListener('global_delta', wrapper);
        return () => streamingManager.events.removeEventListener('global_delta', wrapper);
    }, [isAtBottom, scrollToBottom]);

    return { isAtBottom, scrollToBottom };
}
