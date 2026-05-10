import { describe, it, expect } from 'vitest';
import {
    END_PLACEHOLDER,
    getDisabled,
    getPlaceholder,
    buildOptimisticMessage,
} from '../../client/components/MessageInput.jsx';

describe('END_PLACEHOLDER', () => {
    it('has entries for completed, aborted, error', () => {
        expect(END_PLACEHOLDER.completed).toBe('Session completed');
        expect(END_PLACEHOLDER.aborted).toBe('Session aborted');
        expect(END_PLACEHOLDER.error).toBe('Session failed');
    });
});

describe('getDisabled', () => {
    it('returns false when sessionEndReason is null', () => {
        expect(getDisabled(null)).toBe(false);
    });

    it('returns true when sessionEndReason is "completed"', () => {
        expect(getDisabled('completed')).toBe(true);
    });

    it('returns true when sessionEndReason is "aborted"', () => {
        expect(getDisabled('aborted')).toBe(true);
    });

    it('returns true when sessionEndReason is "error"', () => {
        expect(getDisabled('error')).toBe(true);
    });
});

describe('getPlaceholder', () => {
    it('returns "Type a message..." when sessionEndReason is null', () => {
        expect(getPlaceholder(null)).toBe('Type a message...');
    });

    it('returns "Type a message..." when sessionEndReason is undefined', () => {
        expect(getPlaceholder(undefined)).toBe('Type a message...');
    });

    it('returns session-specific placeholder for completed', () => {
        expect(getPlaceholder('completed')).toBe('Session completed');
    });

    it('returns session-specific placeholder for aborted', () => {
        expect(getPlaceholder('aborted')).toBe('Session aborted');
    });

    it('returns session-specific placeholder for error', () => {
        expect(getPlaceholder('error')).toBe('Session failed');
    });
});

describe('buildOptimisticMessage', () => {
    it('returns message with correct sessionId', () => {
        const msg = buildOptimisticMessage('s99', 'hello world');
        expect(msg.sessionId).toBe('s99');
    });

    it('returns message with role user', () => {
        const msg = buildOptimisticMessage('s1', 'hi');
        expect(msg.role).toBe('user');
    });

    it('returns message with text in content array', () => {
        const msg = buildOptimisticMessage('s1', 'hello world');
        expect(msg.content).toEqual([{ type: 'text', text: 'hello world' }]);
    });

    it('returns message with unique messageId', () => {
        const msg1 = buildOptimisticMessage('s1', 'a');
        const msg2 = buildOptimisticMessage('s1', 'b');
        expect(msg1.messageId).not.toBe(msg2.messageId);
    });

    it('includes messageId property', () => {
        const msg = buildOptimisticMessage('s1', 'test');
        expect(msg.messageId).toBeDefined();
        expect(typeof msg.messageId).toBe('string');
    });

    it('messageId starts with opt_ prefix', () => {
        const msg = buildOptimisticMessage('s1', 'test');
        expect(msg.messageId.startsWith('opt_')).toBe(true);
    });
});
