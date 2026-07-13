import { describe, expect, it } from 'vitest';
import { selectBatchDirsToPrune } from './prune-helpers';
import type { BatchDirInfo } from './prune-helpers';

function d(name: string, newestCreatedAt: number | null): BatchDirInfo {
	return { name, newestCreatedAt };
}

describe('selectBatchDirsToPrune', () => {
	it('keeps the N newest by createdAt and prunes the rest', () => {
		const dirs = [d('old', 1), d('mid', 2), d('new', 3)];
		expect(selectBatchDirsToPrune(dirs, 2).sort()).toEqual(['old']);
	});

	it('prunes nothing when at or under the keep limit', () => {
		expect(selectBatchDirsToPrune([d('a', 1), d('b', 2)], 7)).toEqual([]);
	});

	it('always prunes dirs with no parseable createdAt, even under the limit', () => {
		const dirs = [d('good', 5), d('garbage', null)];
		expect(selectBatchDirsToPrune(dirs, 7)).toEqual(['garbage']);
	});

	it('handles ties deterministically (prunes exactly one among equals)', () => {
		const dirs = [d('a', 1), d('b', 1), d('c', 2)];
		const pruned = selectBatchDirsToPrune(dirs, 2);
		expect(pruned).toHaveLength(1);
		expect(['a', 'b']).toContain(pruned[0]);
	});
});
