import { describe, it, expect } from 'vitest';

describe('southstack-demo functionality', () => {
    it('should return true for a simple assertion', () => {
        expect(true).toBe(true);
    });

    it('should add two numbers correctly', () => {
        const sum = (a, b) => a + b;
        expect(sum(1, 2)).toBe(3);
    });

    it('should concatenate two strings', () => {
        const concat = (a, b) => a + b;
        expect(concat('Hello, ', 'world!')).toBe('Hello, world!');
    });
});