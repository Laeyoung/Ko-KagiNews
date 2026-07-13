export interface BatchDirInfo {
	name: string;
	newestCreatedAt: number | null;
}

/**
 * Returns batch dir names to delete: dirs with no parseable createdAt are
 * always pruned; of the rest, the `keep` newest (by createdAt) survive.
 */
export function selectBatchDirsToPrune(dirs: BatchDirInfo[], keep: number): string[] {
	const dated = dirs
		.filter((dir) => dir.newestCreatedAt !== null)
		.sort((a, b) => (b.newestCreatedAt as number) - (a.newestCreatedAt as number));
	const keepSet = new Set(dated.slice(0, keep).map((dir) => dir.name));
	return dirs.filter((dir) => !keepSet.has(dir.name)).map((dir) => dir.name);
}
