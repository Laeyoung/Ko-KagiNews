import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Make vi available globally
(global as any).vi = vi;

// Mock browser APIs
global.ResizeObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn(),
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock fetch
global.fetch = vi.fn();

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
};
global.localStorage = localStorageMock as any;

// Mock OverlayScrollbars
vi.mock('overlayscrollbars', () => {
	const OverlayScrollbars = vi.fn(() => ({
		options: vi.fn(),
		destroy: vi.fn(),
	}));
	// `useOverlayScrollbars` calls the static `OverlayScrollbars.valid(instance)`
	// in its `$effect.pre`; without it the mock throws before any component renders.
	(OverlayScrollbars as any).valid = vi.fn(() => false);
	return { OverlayScrollbars };
});
