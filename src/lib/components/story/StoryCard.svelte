<script lang="ts">
import { IconX } from '@tabler/icons-svelte';
import { onDestroy, untrack } from 'svelte';
import { browser } from '$app/environment';
import { s } from '$lib/client/localization.svelte';
import { createStoryLocalizer } from '$lib/client/storyLocalization.svelte';
import { displaySettings, readingLevelSettings } from '$lib/data/settings.svelte';
import { useHoverPreloading, useViewportPreloading } from '$lib/hooks/useImagePreloading.svelte';
import { useStoryFlashcards } from '$lib/hooks/useStoryFlashcards.svelte';
import { useStorySimplification } from '$lib/hooks/useStorySimplification.svelte';
import { useStoryTTS } from '$lib/hooks/useStoryTTS.svelte';
import {
	activeFloatingStoryId,
	claimFloatingStoryIfFree,
	nextFloatingStoryId,
	releaseFloatingStory,
	setActiveFloatingStory,
} from '$lib/stores/activeFloatingStory.svelte';
import { computeCategoryScrollTop } from '$lib/utils/storyScroll';
import StoryActions from './StoryActions.svelte';
import StoryContentSkeleton from './StoryContentSkeleton.svelte';
import StoryHeader from './StoryHeader.svelte';
import StorySectionManager from './StorySectionManager.svelte';

// Props
interface Props {
	story: any;
	storyIndex?: number;
	batchId?: string;
	batchDateSlug?: string | null;
	categoryId?: string;
	isRead?: boolean;
	isExpanded?: boolean;
	onToggle?: () => void;
	onReadToggle?: () => void;
	showSourceOverlay?: boolean;
	currentSource?: any;
	sourceArticles?: any[];
	currentMediaInfo?: any;
	isLoadingMediaInfo?: boolean;
	priority?: boolean; // For high-priority stories (first few visible)
	isFiltered?: boolean;
	filterKeywords?: string[];
	shouldAutoScroll?: boolean;
	isSharedView?: boolean;
	isLinkedStory?: boolean; // Story opened from URL/link
	isKeyboardSelected?: boolean; // Story selected via keyboard navigation
}

let {
	story,
	storyIndex,
	batchId,
	batchDateSlug = null,
	categoryId,
	isRead = false,
	isExpanded = false,
	shouldAutoScroll = false,
	onToggle,
	onReadToggle,
	showSourceOverlay = $bindable(false),
	currentSource = $bindable(null),
	sourceArticles = $bindable([]),
	currentMediaInfo = $bindable(null),
	isLoadingMediaInfo = $bindable(false),
	priority = false,
	isFiltered = false,
	filterKeywords = [],
	isSharedView = false,
	isLinkedStory = false,
	isKeyboardSelected = false,
}: Props = $props();

// Story element reference
let storyElement: HTMLElement = undefined!; // Assigned via bind:this

// Mobile floating close button — unique per instance so duplicate titles never collide.
const floatingId = nextFloatingStoryId();
let closeScrollTimer: ReturnType<typeof setTimeout> | undefined;

// Blur state - re-check filtering in real-time
// Track if blurred state should be synced with isFiltered prop
const isFilteredProp = $derived(isFiltered);
let isBlurred = $state(false);
// Track if we're actively revealing (for transition)
let isRevealing = $state(false);

// Reactive: does this card currently own the (single) floating close button?
// (Declared after isBlurred so TS's TDZ analysis doesn't flag a use-before-declaration —
// the $derived callback only runs once the whole script has finished initializing.)
const showFloatingClose = $derived(
	isExpanded &&
		!isBlurred &&
		!isSharedView &&
		!showSourceOverlay &&
		activeFloatingStoryId() === floatingId,
);

// Sync blur state with filter prop when it changes
$effect(() => {
	// Reset blur state to match current filter state
	isBlurred = isFilteredProp;
	// Reset revealing state when filter changes
	isRevealing = false;
});

// Determine language code from story
const storyLanguageCode = $derived(story.sourceLanguage || 'en');

// Get the default reading level for this category
const categoryDefaultLevel = $derived(
	categoryId ? readingLevelSettings.getForCategory(categoryId) : undefined,
);

// Feature composables - each handles its own state and logic
// svelte-ignore state_referenced_locally - storyLanguageCode is intentionally captured at initialization
const simplification = useStorySimplification(story, storyLanguageCode, {
	defaultLevel: categoryDefaultLevel,
	autoSimplify: !!categoryDefaultLevel && categoryDefaultLevel !== 'normal',
});
// svelte-ignore state_referenced_locally - storyLanguageCode is intentionally captured at initialization
const flashcards = useStoryFlashcards(story, storyLanguageCode);
const tts = useStoryTTS(() => simplification.current);

// Use simplified story if available, otherwise use original
const displayStory = $derived(simplification.current);

// Create story-specific localization function
// Pass the story's actual source language when available
const ss = $derived(createStoryLocalizer(isExpanded, story.sourceLanguage));

// Use hooks for preloading
// svelte-ignore state_referenced_locally - story prop is stable per component instance
const viewportPreloader = useViewportPreloading(() => storyElement, story, {
	priority,
});

// svelte-ignore state_referenced_locally - story prop is stable per component instance
const hoverPreloader = useHoverPreloading(story, { priority });

// Track if images are preloaded
const imagesPreloaded = $derived(viewportPreloader.isPreloaded || hoverPreloader.isPreloaded);

// Trigger auto-simplification when story expands
$effect(() => {
	if (isExpanded && !isSharedView) {
		simplification.triggerAutoSimplify();
	}
});

// Handle story click
function handleStoryClick() {
	// In shared view mode, don't allow toggling/closing
	if (isSharedView) return;

	// If blurred, reveal
	if (isBlurred) {
		isRevealing = true;
		isBlurred = false;
		// If story is not yet expanded, expand it after a small delay
		if (!isExpanded) {
			setTimeout(() => {
				if (onToggle) onToggle();
			}, 100);
		}
		// Reset revealing state after animation completes
		setTimeout(() => {
			isRevealing = false;
		}, 300);
		return;
	}

	// If we're closing the story (isExpanded is true), clean up all features
	if (isExpanded) {
		tts.stop();
		simplification.reset();
		flashcards.reset();
	}

	if (onToggle) onToggle();
}

// Mobile floating close: close from anywhere, then scroll back to the story header.
function handleFloatingClose() {
	// Compute the scroll target BEFORE collapsing, while .category-label is still in place.
	const target = browser ? computeCategoryScrollTop(storyElement) : null;

	// Reuse the existing close path (TTS/simplification/flashcards cleanup + toggle + URL).
	handleStoryClick();

	// Keep keyboard focus on the story's title toggle (the floating button unmounts on close).
	// preventScroll avoids a native focus jump fighting the smooth scroll below.
	storyElement
		?.querySelector<HTMLElement>('[data-story-title-button]')
		?.focus({ preventScroll: true });

	// After layout settles, smooth-scroll to the closed story's header.
	if (closeScrollTimer) clearTimeout(closeScrollTimer);
	closeScrollTimer = setTimeout(() => {
		closeScrollTimer = undefined;
		// Skip if another story became active meanwhile (user opened something else):
		// closing released our id → active is null unless a new card claimed it.
		if (target !== null && activeFloatingStoryId() === null) {
			window.scrollTo({ top: target, behavior: 'smooth' });
		}
	}, 150);
}

// Handle read toggle click
function handleReadClick(e: Event) {
	e.stopPropagation();
	if (onReadToggle) onReadToggle();
}

// Scroll to story when expanded
$effect(() => {
	if (isExpanded && browser && storyElement && shouldAutoScroll) {
		setTimeout(() => {
			const categoryElement = storyElement.querySelector('.category-label');
			if (!categoryElement) return;

			const headerEl = document.querySelector('header') || document.querySelector('nav');
			const headerHeight = headerEl ? (headerEl as HTMLElement).offsetHeight : 60;
			const isMobile = window.innerWidth <= 768;
			const extraOffset = isMobile ? 8 : 12;

			// Skip if the category is already correctly positioned below the header.
			const rect = categoryElement.getBoundingClientRect();
			const requiredMargin = headerHeight + extraOffset;
			const isProperlyVisible = rect.top >= requiredMargin && rect.top <= requiredMargin + 20;
			if (isProperlyVisible) return;

			const target = computeCategoryScrollTop(storyElement);
			if (target !== null) {
				window.scrollTo({ top: target, behavior: 'smooth' });
			}
		}, 150);
	}
});

// Decide which expanded card owns the floating close button.
$effect(() => {
	if (!isExpanded || !browser || !storyElement) return;

	// First-expand fallback: take over only if no card is active yet.
	untrack(() => claimFloatingStoryIfFree(floatingId));

	const el = storyElement;

	// 1) Centerline crossing (works regardless of article height).
	const centerObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) setActiveFloatingStory(floatingId);
			}
		},
		{ root: null, rootMargin: '-50% 0px -50% 0px', threshold: 0 },
	);

	// 2) Full visibility (short-content handoff when another long card is active).
	const fullObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.intersectionRatio >= 1) setActiveFloatingStory(floatingId);
			}
		},
		{ root: null, threshold: [0, 1] },
	);

	centerObserver.observe(el);
	fullObserver.observe(el);

	return () => {
		centerObserver.disconnect();
		fullObserver.disconnect();
		// Release only if we still hold it (untracked so this effect never depends on the rune).
		untrack(() => releaseFloatingStory(floatingId));
	};
});

// Unmount-only cleanup for the delayed close-scroll timer.
// NOTE: do NOT clear this timer in the effect cleanup above — closing flips
// isExpanded, which runs that cleanup and would cancel the close's own scroll.
onDestroy(() => {
	if (closeScrollTimer) clearTimeout(closeScrollTimer);
});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<article
  bind:this={storyElement}
  id="story-{story.cluster_number}"
  data-story-id={story.cluster_number?.toString() || story.title}
  data-story-index={storyIndex}
  aria-label="News story: {story.title}"
  class="relative py-2 transition-all duration-200 {isKeyboardSelected ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/10 -mx-2 px-2 rounded-lg' : ''} {isBlurred ? 'cursor-pointer' : ''} {!isExpanded ? 'border-b border-gray-200 dark:border-gray-700' : ''}"
  onmouseenter={hoverPreloader.handleMouseEnter}
  onmouseleave={hoverPreloader.handleMouseLeave}
  onfocus={hoverPreloader.handleMouseEnter}
  onclick={isBlurred ? handleStoryClick : undefined}
  onkeydown={isBlurred ? (e) => e.key === "Enter" && handleStoryClick() : undefined}
  role={isBlurred ? "button" : undefined}
  tabindex={isBlurred ? 0 : undefined}
>
  <!-- Blurrable Content -->
  <div class:transition-all={isRevealing} class:duration-200={isRevealing} class:blur-lg={isBlurred} class:pointer-events-none={isBlurred}>
    <!-- Story Header -->
    <StoryHeader
      story={displayStory}
      {isRead}
      {isSharedView}
      {isExpanded}
      onTitleClick={handleStoryClick}
      onReadClick={handleReadClick}
      onFlashcardsClick={flashcards.toggle}
      onExportClick={flashcards.exportFlashcards}
      onDownloadClick={flashcards.download}
      onTtsClick={tts.play}
      onTtsDownloadClick={tts.download}
      ttsStatus={tts.status}
      onSimplifyLevelSelect={simplification.selectLevel}
      selectedLevel={simplification.selectedLevel}
      isSimplifying={simplification.isLoading}
      flashcardMode={flashcards.enabled}
      isExporting={flashcards.isExporting}
      exportedCSV={flashcards.exportedCSV}
      selectedWordsCount={flashcards.selectedCount}
    />

    <!-- Expanded Content -->
    {#if isExpanded}
      <div
        class="dark:bg-dark-bg flex flex-col bg-white py-4 [&>section:first-of-type]:mt-0"
        role="region"
        aria-label="Story content"
      >
        <!-- Show skeleton while auto-simplifying -->
        {#if simplification.isLoading && simplification.isAutoSimplified}
          <StoryContentSkeleton readingLevel={simplification.defaultLevel} />
        {:else}
          <!-- Dynamic Sections based on user settings -->
          <StorySectionManager
            story={displayStory}
            {imagesPreloaded}
            bind:showSourceOverlay
            bind:currentSource
            bind:sourceArticles
            bind:currentMediaInfo
            bind:isLoadingMediaInfo
            storyLocalizer={ss}
            flashcardMode={flashcards.enabled && !flashcards.isExporting}
            selectedWords={flashcards.selectedWords}
            selectedPhrases={flashcards.selectedPhrases}
            shouldJiggle={flashcards.shouldJiggle}
            onWordClick={flashcards.selectWord}
          />
        {/if}

        <!-- Action Buttons -->
        <StoryActions
          story={displayStory}
          {batchId}
          {batchDateSlug}
          {categoryId}
          {storyIndex}
          onClose={handleStoryClick}
          {isSharedView}
          storyLocalizer={ss}
        />
      </div>
    {/if}
  </div>

  {#if showFloatingClose}
    <button
      type="button"
      onclick={handleFloatingClose}
      aria-label={ss("article.closeStory.aria") || "Close story and return to category list"}
      class="hidden max-[768px]:flex fixed left-1/2 -translate-x-1/2 z-fixed size-12 items-center justify-center rounded-full bg-black text-white shadow-lg transition-colors duration-200 hover:bg-gray-800 focus-visible-ring {displaySettings.categoryHeaderPosition === 'bottom' ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))]'}"
    >
      <IconX class="size-6" aria-hidden="true" />
    </button>
  {/if}

  <!-- Blur Warning Overlay -->
  {#if isBlurred && filterKeywords && filterKeywords.length > 0}
    <div
      class="absolute left-0 top-4 z-dropdown flex items-center gap-3 px-4"
      role="alert"
      aria-live="polite"
    >
      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
        {isLinkedStory
          ? (s("contentFilter.linkedStoryFilteredBecause") || "The story you wanted to view is blocked by your content filter:")
          : (s("contentFilter.filteredBecause") || "Hidden due to filter:")}
      </span>
      <div class="flex items-center gap-2">
        {#each filterKeywords.slice(0, 3) as keyword}
          <span
            class="text-xs font-semibold text-gray-800 dark:text-gray-200 bg-white/50 dark:bg-black/30 px-2 py-0.5 rounded"
          >
            {keyword}
          </span>
        {/each}
        {#if filterKeywords.length > 3}
          <span class="text-xs text-gray-600 dark:text-gray-400">
            +{filterKeywords.length - 3}
          </span>
        {/if}
      </div>
      <span class="text-xs text-gray-600 dark:text-gray-400 italic">
        {isLinkedStory
          ? (s("contentFilter.linkedStoryClickToReveal") || "Click to show anyway")
          : (s("contentFilter.clickToReveal") || "Click to show")}
      </span>
    </div>
  {/if}
</article>
