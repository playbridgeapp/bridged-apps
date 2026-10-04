<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { BrowserResume, forwardNativeVideoEvents } from '../browser-resume';
  import moviWasmUrl from 'movi-player/movi.wasm?url';
  import {
    activePlayer,
    stopPlayback,
    castCurrentPlayback,
    playOnThisScreen,
    recordBrowserProgress,
    recordBrowserStopped,
    skipNextTrack,
    skipPrevTrack,
    nextBrowserPlayback,
    prefetchNextBrowserTrack,
    resolveItemPosterUrl,
    resolveItemBackdropUrl,
    isShuffle,
    repeatMode,
    isQueueDrawerOpen,
    isLyricsOpen,
    toggleShuffle,
    cycleRepeatMode,
    toggleFavorite
  } from '../stores/appState';
  import {
    bridgeStatus,
    playbackError,
    addDiagnosticLog
  } from '../cast/playbridge';
  import {
    Play,
    Pause,
    RotateCcw,
    RotateCw,
    Volume2,
    VolumeX,
    Maximize,
    Minimize,
    Cast,
    X,
    ChevronUp,
    ChevronDown,
    SkipForward,
    SkipBack,
    Music,
    Shuffle,
    Repeat,
    Repeat1,
    ListMusic,
    Mic2,
    Heart,
    Loader2,
    Zap
  } from 'lucide-svelte';

  let moviEl: any;
  let videoEl: HTMLVideoElement;
  let audioElA: HTMLAudioElement;
  let audioElB: HTMLAudioElement;
  let activeAudioIndex = 0; // 0: audioElA, 1: audioElB
  let playerContainer: HTMLDivElement;

  function getActiveAudioEl(): HTMLAudioElement | undefined {
    return activeAudioIndex === 0 ? audioElA : audioElB;
  }

  function getStandbyAudioEl(): HTMLAudioElement | undefined {
    return activeAudioIndex === 0 ? audioElB : audioElA;
  }

  let isMoviLoaded = false;
  let isMoviLoading = false;
  let moviSupported = true;

  let isPlaying = false;
  let currentTime = 0;
  let duration = 0;
  let volume = 1;
  let isMuted = false;
  let isFullscreen = false;
  let showControls = true;
  let hideControlsTimer: any;
  let reportProgressTimer: any;

  $: playerState = $activePlayer;
  $: isCastingActive = playerState.isCasting;
  $: isAudio = playerState.item?.Type === 'Audio';
  $: hasPlaylist = (playerState.playlist?.length ?? 0) > 1;
  $: isFavorite = !!playerState.item?.UserData?.IsFavorite;
  $: posterUrl = playerState.item ? resolveItemPosterUrl(playerState.item) : '';
  $: backdropUrl = isAudio ? posterUrl : (playerState.item ? resolveItemBackdropUrl(playerState.item) : '');
  // Stream URLs carry Jellyfin authentication. Never attach account headers to demo/public media.
  $: authHeadersJson = '{}';

  // Next Track in playlist queue for pre-buffering
  $: nextItem = (hasPlaylist && playerState.playlist && playerState.currentIndex != null)
    ? playerState.playlist[playerState.currentIndex + 1]
    : null;
  $: if (playerState.isOpen && isAudio && !isCastingActive) prefetchNextBrowserTrack(playerState);
  $: nextStreamUrl = nextItem ? $nextBrowserPlayback?.url || '' : '';
  $: nextPosterUrl = nextItem ? resolveItemPosterUrl(nextItem) : '';

  let currentPlayingUrl = '';
  let prebufferedNextUrl = '';
  let audioPrepared: typeof playerState.prepared;

  function audioHasUrl(el: HTMLAudioElement | undefined, url: string): boolean {
    if (!el || !url) return false;
    const attr = el.getAttribute('src') || '';
    return attr === url || el.src === url;
  }

  function playAudioElement(el: HTMLAudioElement) {
    const prepared = playerState.prepared;
    const current = () => getActiveAudioEl() === el && playerState.prepared === prepared && !isCastingActive && playerState.isOpen;
    const pending = el.play();
    if (pending && typeof pending.then === 'function') {
      pending
        .then(() => {
          if (current()) isPlaying = true;
        })
        .catch((err) => {
          if (!current()) return;
          isPlaying = false;
          addDiagnosticLog(
            'error',
            `Audio play() failed: ${err?.name || ''} ${err?.message || err}`
          );
        });
    } else {
      isPlaying = true;
    }
  }

  function applyAudioUrl(url: string): boolean {
    const standby = getStandbyAudioEl();
    const currentActive = getActiveAudioEl();
    if (!currentActive) return false;

    if (standby && audioHasUrl(standby, url) && standby.readyState >= 2) {
      currentActive.pause();
      currentActive.currentTime = 0;
      activeAudioIndex = activeAudioIndex === 0 ? 1 : 0;
      const newActive = getActiveAudioEl();
      if (newActive) {
        newActive.volume = volume;
        newActive.muted = isMuted;
        playAudioElement(newActive);
      }
    } else {
      if (!audioHasUrl(currentActive, url)) {
        currentActive.src = url;
      } else {
        // A repeat/duplicate entry is a new playback even when its URL is identical.
        currentActive.pause();
        currentActive.currentTime = 0;
      }
      currentActive.volume = volume;
      currentActive.muted = isMuted;
      playAudioElement(currentActive);
    }
    currentPlayingUrl = url;
    audioPrepared = playerState.prepared;
    return true;
  }

  // Keep audio nodes mounted (see template) so the first Play after refresh can
  // call play() on a live element. Do not mark the URL current until bind:this exists;
  // otherwise the reactive block never retries and the track is silent.
  $: if (
    audioElA &&
    playerState.isOpen &&
    isAudio &&
    !playerState.isCasting &&
    playerState.streamUrl &&
    (playerState.streamUrl !== currentPlayingUrl || playerState.prepared !== audioPrepared)
  ) {
    applyAudioUrl(playerState.streamUrl);
  }

  const browserResume = new BrowserResume();
  let browserPrepared: typeof playerState.prepared;
  let nativeCleanup: (() => void) | null = null;
  $: if (playerState.prepared !== browserPrepared) {
    nativeCleanup?.(); nativeCleanup = null;
    browserPrepared = playerState.prepared;
    currentTime = (browserPrepared?.startPositionMs || 0) / 1000;
    duration = 0;
  }
  $: if (isCastingActive) {
    currentTime = (playerState.positionMs || 0) / 1000;
    duration = (playerState.durationMs || 0) / 1000;
    isPlaying = playerState.nativeState === 'playing';
  }
  function activeMedia(): any { return isAudio ? getActiveAudioEl() : moviEl || videoEl; }
  function handleReady() {
    if (isCastingActive || !playerState.isOpen) return;
    const media = activeMedia();
    if (media) browserResume.apply(media, browserPrepared);
  }
  function handlePlay() { isPlaying = true; handleReady(); }
  function handlePlaybackError() {
    playbackError.set('Browser playback failed. Try another media version or choose a PlayBridge device.');
  }
  function handlePause() { isPlaying = false; saveBrowserProgress(true); }
  function saveBrowserProgress(force = false) {
    const media = activeMedia();
    if (!media || !playerState.isOpen || isCastingActive || (isAudio && !audioHasUrl(media, playerState.streamUrl))
      || !browserResume.observe(media, browserPrepared)) return;
    recordBrowserProgress(Number(media.currentTime || 0) * 1000, !!media.paused, force);
  }
  function handleNativeFallback(event: Event) {
    nativeCleanup?.(); nativeCleanup = null;
    const host = event.currentTarget as HTMLElement;
    const prepared = browserPrepared;
    const video = [...(host.shadowRoot?.querySelectorAll('video') || [])].find(media => getComputedStyle(media).display !== 'none');
    if (!video) return;
    nativeCleanup = forwardNativeVideoEvents(host, video,
      () => host === moviEl && browserPrepared === prepared && host.shadowRoot?.contains(video) === true);
  }
  function notifyPlaybackStopped() {
    saveBrowserProgress(true);
    recordBrowserStopped();
  }

  $: if (!playerState.isOpen || playerState.isCasting || !isAudio) {
    audioElA?.pause();
    audioElB?.pause();
    if (!playerState.isOpen) {
      notifyPlaybackStopped();
      if (currentPlayingUrl || audioElA?.getAttribute('src')) {
        if (audioElA) {
          audioElA.removeAttribute('src');
          audioElA.load();
        }
        if (audioElB) {
          audioElB.removeAttribute('src');
          audioElB.load();
        }
        currentPlayingUrl = '';
        prebufferedNextUrl = '';
        isPlaying = false;
      }
    }
  }

  // Pre-buffer next track into standby audio element ahead of time
  $: if (playerState.isOpen && !isCastingActive && isAudio && nextStreamUrl) {
    const standby = activeAudioIndex === 0 ? audioElB : audioElA;
    if (standby && nextStreamUrl !== prebufferedNextUrl && nextStreamUrl !== currentPlayingUrl) {
      prebufferedNextUrl = nextStreamUrl;
      standby.src = nextStreamUrl;
      standby.preload = 'auto';
      standby.load();
      addDiagnosticLog('info', `Pre-buffered next audio track: ${nextItem?.Name || ''}`);
    }
  } else if (!nextStreamUrl) {
    const standby = getStandbyAudioEl();
    prebufferedNextUrl = '';
    if (standby && standby.getAttribute('src')) {
      standby.removeAttribute('src');
      standby.load();
    }
  }

  // Pre-load next artwork image into browser cache
  $: if (nextPosterUrl && typeof Image !== 'undefined') {
    const img = new Image();
    img.src = nextPosterUrl;
  }

  // Lazy-load movi-player on demand when video playback starts
  $: if (playerState.isOpen && !isAudio && !isCastingActive && !isMoviLoaded && moviSupported && typeof window !== 'undefined') {
    ensureMoviPlayer();
  }

  async function ensureMoviPlayer() {
    if (typeof window === 'undefined') return;
    if (customElements.get('movi-player')) {
      isMoviLoaded = true;
      return true;
    }
    isMoviLoading = true;
    try {
      // Dynamic on-demand code splitting chunk import
      await import('movi-player/element');
      isMoviLoaded = true;
      return true;
    } catch (err) {
      console.warn('Movi player load failed or not supported, falling back to native video:', err);
      moviSupported = false;
      return false;
    } finally {
      isMoviLoading = false;
    }
  }

  onMount(() => {
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    reportProgressTimer = setInterval(() => { handleTimeUpdate(); }, 1000);
  });

  onDestroy(() => {
    notifyPlaybackStopped();
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    nativeCleanup?.();
    clearInterval(reportProgressTimer);
    clearTimeout(hideControlsTimer);
  });

  function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
  }

  function togglePlay() {
    if (isCastingActive) {
      addDiagnosticLog('info', 'Use PlayBridge Remote for native playback controls.');
      return;
    }
    const currentActive = getActiveAudioEl();
    if (isAudio && currentActive) {
      if (currentActive.paused) currentActive.play().catch(() => {});
      else currentActive.pause();
      return;
    }
    if (moviEl) {
      if (moviEl.paused) moviEl.play().catch(() => {});
      else moviEl.pause();
      return;
    }
    if (videoEl) {
      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    }
  }

  function handleMediaEnded() {
    handleTimeUpdate();
    saveBrowserProgress(true);
    recordBrowserStopped();
    skipNextTrack();
  }

  function handleTimeUpdate() {
    if (!playerState.isOpen || isCastingActive) return;
    const media = activeMedia();
    if (!media || (isAudio && !audioHasUrl(media, playerState.streamUrl))) return;
    const time = Number(media.currentTime || 0);
    duration = Number(media.duration || 0);
    if (!browserResume.observe(media, browserPrepared)) return;
    currentTime = time;
    saveBrowserProgress();
  }

  function handleSeek(e: Event) {
    const target = e.target as HTMLInputElement;
    const seekTime = parseFloat(target.value);
    currentTime = seekTime;
    const currentActive = getActiveAudioEl();
    if (isAudio && currentActive) {
      currentActive.currentTime = seekTime;
    } else if (moviEl) {
      moviEl.currentTime = seekTime;
    } else if (videoEl) {
      videoEl.currentTime = seekTime;
    }
  }

  function skip(seconds: number) {
    const currentActive = getActiveAudioEl();
    if (isAudio && currentActive) {
      currentActive.currentTime = Math.max(0, Math.min(duration, currentActive.currentTime + seconds));
    } else if (moviEl) {
      moviEl.currentTime = Math.max(0, Math.min(duration, moviEl.currentTime + seconds));
    } else if (videoEl) {
      videoEl.currentTime = Math.max(0, Math.min(duration, videoEl.currentTime + seconds));
    }
  }

  function toggleMute() {
    const currentActive = getActiveAudioEl();
    const standby = getStandbyAudioEl();
    if (isAudio && currentActive) {
      currentActive.muted = !currentActive.muted;
      isMuted = currentActive.muted;
      if (standby) standby.muted = isMuted;
    } else if (moviEl) {
      moviEl.muted = !moviEl.muted;
      isMuted = moviEl.muted;
    } else if (videoEl) {
      videoEl.muted = !videoEl.muted;
      isMuted = videoEl.muted;
    }
  }

  function handleVolumeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    volume = parseFloat(target.value);
    const currentActive = getActiveAudioEl();
    const standby = getStandbyAudioEl();
    if (isAudio && currentActive) {
      currentActive.volume = volume;
      currentActive.muted = volume === 0;
      isMuted = currentActive.muted;
      if (standby) {
        standby.volume = volume;
        standby.muted = isMuted;
      }
    } else if (moviEl) {
      moviEl.volume = volume;
      moviEl.muted = volume === 0;
      isMuted = moviEl.muted;
    } else if (videoEl) {
      videoEl.volume = volume;
      videoEl.muted = volume === 0;
      isMuted = videoEl.muted;
    }
  }

  function toggleFullscreen() {
    if (!playerContainer) return;
    if (!document.fullscreenElement) {
      playerContainer.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function handleMouseMove() {
    showControls = true;
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => {
      if (isPlaying) {
        showControls = false;
      }
    }, 3500);
  }

  function minimizePlayer() {
    activePlayer.update((s) => ({ ...s, isExpanded: false }));
  }

  function expandPlayer() {
    activePlayer.update((s) => ({ ...s, isExpanded: true }));
  }

  function openQueue() {
    $isLyricsOpen = false;
    $isQueueDrawerOpen = true;
  }

  function openLyrics() {
    $isLyricsOpen = true;
    $isQueueDrawerOpen = true;
  }

  function closePlayer() {
    if (audioElA) {
      audioElA.pause();
      audioElA.src = '';
    }
    if (audioElB) {
      audioElB.pause();
      audioElB.src = '';
    }
    if (moviEl) moviEl.pause();
    if (videoEl) videoEl.pause();
    currentPlayingUrl = '';
    prebufferedNextUrl = '';
    isPlaying = false;
    notifyPlaybackStopped();
    stopPlayback();
  }

  async function triggerDirectCast() {
    await castCurrentPlayback(currentTime * 1000);
  }
  function disconnectCast() { void playOnThisScreen(); }

  function formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<!-- Always mounted so the first Play after a refresh is not racing bind:this. -->
<audio
  bind:this={audioElA}
  on:play={() => { if (activeAudioIndex === 0) handlePlay(); }}
  on:pause={() => { if (activeAudioIndex === 0) handlePause(); }}
  on:loadedmetadata={handleReady}
  on:canplay={handleReady}
  on:seeked={handleReady}
  on:timeupdate={() => { if (activeAudioIndex === 0) handleTimeUpdate(); }}
  on:ended={() => { if (activeAudioIndex === 0) handleMediaEnded(); }}
  class="hidden-audio-el"
  preload="auto"
></audio>
<audio
  bind:this={audioElB}
  on:play={() => { if (activeAudioIndex === 1) handlePlay(); }}
  on:pause={() => { if (activeAudioIndex === 1) handlePause(); }}
  on:loadedmetadata={handleReady}
  on:canplay={handleReady}
  on:seeked={handleReady}
  on:timeupdate={() => { if (activeAudioIndex === 1) handleTimeUpdate(); }}
  on:ended={() => { if (activeAudioIndex === 1) handleMediaEnded(); }}
  class="hidden-audio-el"
  preload="auto"
></audio>

{#if playerState.isOpen}
  <!-- ==================== MINI PLAYER BAR (Bottom Floating Dock) ==================== -->
  {#if !playerState.isExpanded}
    <div class="mini-player-bar" on:click={expandPlayer}>
      <!-- Top Progress Line -->
      {#if duration > 0}
        <div class="mini-progress-track">
          <div class="mini-progress-fill" style="width: {(currentTime / duration) * 100}%"></div>
        </div>
      {/if}

      <!-- Left Media Info -->
      <div class="mini-left">
        {#if posterUrl}
          <div class="mini-thumb-wrapper">
            <img src={posterUrl} alt={playerState.title} class="mini-thumb" />
          </div>
        {/if}

        <div class="mini-meta">
          <div class="mini-title-row">
            <span class="mini-title">{playerState.title}</span>
            <span class="mini-expand-hint" title="Expand player">
              <ChevronUp size={14} />
            </span>
            {#if isCastingActive}
              <div class="mini-cast-indicator" title={playerState.isLinkedCast ? 'Native playback session' : 'Cast request dispatched'}>
                <Cast size={15} class="cast-glow-icon" />
              </div>
            {/if}
          </div>
          {#if playerState.item?.AlbumArtist || (playerState.item?.Artists && playerState.item.Artists.length > 0)}
            <span class="mini-sub">{playerState.item.AlbumArtist || playerState.item.Artists?.[0]}</span>
          {:else if playerState.season && playerState.episode}
            <span class="mini-sub">S{playerState.season}E{playerState.episode}</span>
          {:else}
            <span class="mini-sub">{isCastingActive ? playerState.destinationName || 'PlayBridge' : (isAudio ? 'Audio Player' : 'Video Player')}</span>
          {/if}
        </div>
      </div>

      <!-- Right Controls -->
      <div class="mini-controls" on:click|stopPropagation>
        {#if playerState.item}
          <button
            class="mini-btn"
            class:active-fav={isFavorite}
            on:click={() => playerState.item && toggleFavorite(playerState.item)}
            title="Favorite"
          >
            <Heart size={16} fill={isFavorite ? '#e74c3c' : 'none'} color={isFavorite ? '#e74c3c' : 'currentColor'} />
          </button>
        {/if}

        {#if hasPlaylist}
          <button class="mini-btn" on:click={skipPrevTrack} title="Previous track">
            <SkipBack size={17} />
          </button>
        {/if}

        <button class="mini-btn mini-play-btn" disabled={isCastingActive} on:click={togglePlay} title={isCastingActive ? 'Use PlayBridge Remote for playback controls' : isPlaying ? 'Pause' : 'Play'}>
          {#if isPlaying}
            <Pause size={18} fill="currentColor" />
          {:else}
            <Play size={18} fill="currentColor" />
          {/if}
        </button>

        {#if hasPlaylist}
          <button class="mini-btn" on:click={skipNextTrack} title="Next track">
            <SkipForward size={17} />
          </button>
        {/if}

        {#if hasPlaylist}
          <button class="mini-btn" on:click={openQueue} title="Queue & Lyrics">
            <ListMusic size={17} />
          </button>
        {/if}

        <button class="mini-btn mini-expand-btn" on:click={expandPlayer} title="Expand player">
          <ChevronUp size={18} />
        </button>

        <button class="mini-btn mini-close-btn" on:click={closePlayer} title={isCastingActive ? "Unlink & close (playback continues)" : "Stop & close"}>
          <X size={18} />
        </button>
      </div>
    </div>
  {/if}

  <!-- ==================== FULL EXPANDED PLAYER OVERLAY ==================== -->
  {#if playerState.isExpanded}
    <div
      class="player-overlay"
      bind:this={playerContainer}
      on:mousemove={handleMouseMove}
    >
      <!-- Top Header Bar Overlay -->
      <div class="player-top-bar" class:visible={showControls || !isPlaying || isCastingActive || isAudio}>
        <button class="icon-btn-large" on:click={minimizePlayer} title="Minimize to mini-player (keep browsing)">
          <ChevronDown size={22} />
        </button>

        <div class="title-group">
          <h3 class="playing-title" title={playerState.title}>{playerState.title}</h3>
          {#if playerState.season && playerState.episode}
            <span class="playing-sub">Season {playerState.season} &bull; Episode {playerState.episode}</span>
          {:else if playerState.item?.AlbumArtist || (playerState.item?.Artists && playerState.item.Artists.length > 0)}
            <span class="playing-sub">{playerState.item.AlbumArtist || playerState.item.Artists?.[0]}</span>
          {/if}
        </div>

        <div class="top-actions">
          {#if hasPlaylist}
            <button class="queue-counter-btn" on:click={openQueue} title="View Queue & Lyrics">
              <ListMusic size={16} />
              <span>{((playerState.currentIndex ?? 0) + 1)} / {playerState.playlist?.length}</span>
            </button>
          {/if}

          {#if !isCastingActive && $bridgeStatus.available}
            <button class="cast-btn" on:click={triggerDirectCast} title="Switch to PlayBridge Casting">
              <Cast size={16} />
              <span class="cast-text">Cast</span>
            </button>
          {:else if isCastingActive}
            <button class="cast-btn active-cast" on:click={disconnectCast} title="Switch to browser playback (native playback is unlinked)">
              <Cast size={16} />
              <span class="cast-text">{playerState.isLinkedCast ? 'Native playback' : 'Cast sent'}</span>
            </button>
          {/if}

          <button class="icon-btn-large" on:click={closePlayer} title={isCastingActive ? "Unlink & close (playback continues)" : "Stop and Close Player"}>
            <X size={22} />
          </button>
        </div>
      </div>

      {#if $playbackError}<p class="player-error" role="alert">{$playbackError}</p>{/if}
      <!-- Center Player Body -->
      {#if isCastingActive}
        <!-- Cast HUD (Playing on TV Receiver) -->
        <div class="cast-hud-container">
          <div class="cast-poster-card">
            {#if posterUrl}
              <img src={posterUrl} alt={playerState.title} class="cast-hud-poster" />
            {/if}
            <div class="cast-hud-glow"></div>
          </div>

          <div class="cast-status-card">
            <div class="cast-signal-row">
              <div class="tv-icon-wrapper">
                <Cast size={32} class="tv-icon" />
                <span class="radar-pulse"></span>
              </div>
              <div class="signal-details">
                <h4>{playerState.isLinkedCast ? (playerState.nativeState === 'playing' ? 'Playing on' : playerState.nativeState === 'paused' ? 'Paused on' : 'Opening playback on') : 'Cast dispatched to'} {playerState.destinationName || 'PlayBridge receiver'}</h4>
                <p>Use PlayBridge’s Remote to control native playback. Unlinking leaves playback running.</p>
                <p class="signal-url">{playerState.isLinkedCast ? `Session status: ${playerState.nativeState || 'connecting'}` : 'This legacy host does not report playback status.'}</p>
              </div>
            </div>

            <div class="cast-actions-row">
              <button class="btn-accent" on:click={minimizePlayer}>
                <span>Browse Library</span>
              </button>
              <button class="btn-secondary" on:click={disconnectCast}>
                <span>Play on This Screen</span>
              </button>
            </div>
          </div>
        </div>
      {:else if isAudio}
        <!-- Audio Fullscreen Player HUD (Finamp Aesthetic) -->
        <div class="audio-hud-container">
          {#if backdropUrl}
            <div class="audio-bg-blur" style="background-image: url('{backdropUrl}')"></div>
          {/if}
          <div class="audio-hud-overlay-gradient"></div>

          <div class="audio-card">
            <div class="audio-artwork-wrapper">
              {#if posterUrl}
                <img src={posterUrl} alt={playerState.title} class="audio-artwork" />
              {:else}
                <div class="audio-placeholder">
                  <Music size={64} />
                </div>
              {/if}
            </div>

            <div class="audio-meta">
              <div class="audio-title-fav-row">
                <h2 class="audio-title" title={playerState.title}>{playerState.title}</h2>
                {#if playerState.item}
                  <button
                    class="fav-btn-round"
                    class:active-fav={isFavorite}
                    on:click={() => playerState.item && toggleFavorite(playerState.item)}
                    title="Favorite"
                  >
                    <Heart size={20} fill={isFavorite ? '#e74c3c' : 'none'} color={isFavorite ? '#e74c3c' : 'currentColor'} />
                  </button>
                {/if}
              </div>
              <p class="audio-artist">
                {playerState.item?.AlbumArtist || playerState.item?.Artists?.[0] || 'Unknown Artist'}
              </p>
              {#if playerState.item?.Album}
                <p class="audio-album">{playerState.item.Album}</p>
              {/if}

              <!-- Pre-buffer / Up Next indicator -->
              {#if nextItem}
                <div class="next-up-indicator">
                  <Zap size={12} class="zap-icon" />
                  <span>Next: {nextItem.Name}</span>
                </div>
              {/if}
            </div>

            <!-- Scrubber -->
            <div class="audio-scrubber-box">
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                on:input={handleSeek}
                class="scrubber-range"
              />
              <div class="time-display">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <!-- Finamp Music Controls: Shuffle, Prev, Play, Next, Repeat -->
            <div class="audio-controls-row">
              <button
                class="mode-icon-btn"
                class:active-mode={$isShuffle}
                on:click={toggleShuffle}
                title="Shuffle"
              >
                <Shuffle size={20} />
              </button>

              {#if hasPlaylist}
                <button class="control-icon-btn" on:click={skipPrevTrack} title="Previous track">
                  <SkipBack size={24} />
                </button>
              {/if}

              <button class="play-toggle-btn-large" disabled={isCastingActive} on:click={togglePlay}>
                {#if isPlaying}
                  <Pause size={28} fill="currentColor" />
                {:else}
                  <Play size={28} fill="currentColor" />
                {/if}
              </button>

              {#if hasPlaylist}
                <button class="control-icon-btn" on:click={skipNextTrack} title="Next track">
                  <SkipForward size={24} />
                </button>
              {/if}

              <button
                class="mode-icon-btn"
                class:active-mode={$repeatMode !== 'off'}
                on:click={cycleRepeatMode}
                title="Repeat Mode ({$repeatMode})"
              >
                {#if $repeatMode === 'one'}
                  <Repeat1 size={20} />
                {:else}
                  <Repeat size={20} />
                {/if}
              </button>
            </div>

            <!-- Quick Actions Bar for mobile/desktop: Queue & Lyrics, Direct Cast -->
            <div class="audio-quick-bar">
              <button class="quick-bar-btn" on:click={openQueue} title="Queue & Playlist">
                <ListMusic size={15} />
                <span>Up Next ({playerState.playlist?.length ?? 1})</span>
              </button>

              <button class="quick-bar-btn" on:click={openLyrics} title="Lyrics">
                <Mic2 size={15} />
                <span>Lyrics</span>
              </button>

              {#if !isCastingActive && $bridgeStatus.available}
                <button class="quick-bar-btn" on:click={triggerDirectCast} title="Direct Cast">
                  <Cast size={15} />
                  <span>Cast</span>
                </button>
              {/if}
            </div>
          </div>
        </div>
      {:else}
        <!-- Video Player: Dynamic Movi Player with Native Hardware Video Fallback -->
        {#if isMoviLoading}
          <div class="video-loading-box">
            <Loader2 size={40} class="spinner" />
            <p>Initializing high-performance player engine...</p>
          </div>
        {:else if isMoviLoaded && moviSupported}
          <div class="movi-player-wrapper">
            {#key playerState.prepared}
              <movi-player
                bind:this={moviEl}
                src={playerState.streamUrl}
                poster={posterUrl}
                title={playerState.title}
                controls
                autoplay
                playsinline
                theme="dark"
                themecolor="#95FF50 #7A6BAE"
                ambientmode
                headers={authHeadersJson}
                wasmurl={moviWasmUrl}
                fallback="native"
                on:nativefallback={handleNativeFallback}
                on:error={handlePlaybackError}
                on:play={handlePlay}
                on:pause={handlePause}
                on:loadedmetadata={handleReady}
                on:canplay={handleReady}
                on:seeked={handleReady}
                on:timeupdate={handleTimeUpdate}
                on:ended={handleMediaEnded}
                class="movi-element"
              >
                {#each playerState.prepared?.subtitleResources || [] as track}
                  <track kind="subtitles" src={track.url} label={track.label || 'Subtitles'} srclang={track.language || 'und'} default />
                {/each}
              </movi-player>
            {/key}
          </div>
        {:else}
          <div class="video-player-container">
            {#key playerState.prepared}
              <video
                bind:this={videoEl}
                src={playerState.streamUrl}
                poster={posterUrl}
                autoplay
                playsinline
                controls
                on:play={handlePlay}
                on:pause={handlePause}
                on:loadedmetadata={handleReady}
                on:canplay={handleReady}
                on:seeked={handleReady}
                on:timeupdate={handleTimeUpdate}
                on:ended={handleMediaEnded}
                crossorigin="anonymous"
                on:error={handlePlaybackError}
                class="native-video-el"
              >
                {#each playerState.prepared?.subtitleResources || [] as track}
                  <track kind="subtitles" src={track.url} label={track.label || 'Subtitles'} srclang={track.language || 'und'} default />
                {/each}
              </video>
            {/key}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
{/if}

<style>
  .player-error { position: absolute; bottom: 75px; left: 5%; right: 5%; z-index: 10; padding: 12px; color: #ffd5d0; background: #251719; border-radius: 8px; }
  .hidden-audio-el {
    display: none;
  }

  /* ==================== MINI PLAYER BAR ==================== */
  .mini-player-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 64px;
    background: rgba(29, 23, 40, 0.88);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-top: 1px solid rgba(122, 107, 174, 0.25);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    z-index: 45;
    cursor: pointer;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.6);
    transition: transform 0.2s ease;
  }

  .mini-progress-track {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: rgba(255, 255, 255, 0.1);
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--theme-progress-filled);
    box-shadow: 0 0 6px rgba(95, 184, 44, 0.8);
  }

  .mini-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .mini-thumb-wrapper {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--theme-background-secondary);
    border: 1px solid rgba(122, 107, 174, 0.25);
  }

  .mini-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mini-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .mini-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mini-expand-hint {
    display: none;
    line-height: 0;
    color: var(--text-muted);
  }

  .mini-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-cast-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--theme-primary-accent);
    filter: drop-shadow(0 0 6px rgba(149, 255, 80, 0.8));
    animation: pulseCast 2s infinite ease-in-out;
  }

  @keyframes pulseCast {
    0% { transform: scale(0.95); opacity: 0.8; }
    50% { transform: scale(1.1); opacity: 1; }
    100% { transform: scale(0.95); opacity: 0.8; }
  }

  .mini-sub {
    font-size: 0.74rem;
    color: var(--theme-type-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .mini-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mini-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    background: rgba(30, 23, 40, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.25);
    transition: all 0.15s ease;
  }

  .mini-btn:hover {
    color: #fff;
    background: rgba(60, 47, 82, 0.85);
  }

  .mini-btn.active-fav {
    color: #ff5252;
    border-color: rgba(255, 82, 82, 0.4);
  }

  .mini-play-btn {
    background: var(--theme-primary-accent);
    color: #050505;
    border-color: transparent;
    box-shadow: 0 0 12px rgba(149, 255, 80, 0.35);
  }

  .mini-play-btn:hover {
    filter: brightness(1.1);
  }

  .mini-close-btn:hover {
    background: rgba(248, 81, 73, 0.2);
    border-color: var(--status-error);
    color: var(--status-error);
  }

  @media (max-width: 768px) {
    .mini-player-bar {
      bottom: calc(86px + env(safe-area-inset-bottom, 16px));
      height: 58px;
      padding: 0 14px;
      margin: 0 12px;
      border-radius: var(--radius-full);
      border: 1px solid rgba(122, 107, 174, 0.3);
      z-index: 92;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.85);
    }
    .mini-thumb-wrapper {
      width: 38px;
      height: 38px;
    }
    .mini-expand-btn {
      display: none;
    }
    .mini-expand-hint {
      display: flex;
      flex-shrink: 0;
      color: var(--text-muted);
      opacity: 0.85;
    }
  }

  /* ==================== FULL EXPANDED PLAYER OVERLAY ==================== */
  .player-overlay {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    background: #09060f !important;
    z-index: 100 !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: space-between !important;
    overflow: hidden !important;
  }

  .player-top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 16px 20px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    background: linear-gradient(to bottom, rgba(9, 6, 15, 0.95) 0%, rgba(9, 6, 15, 0.6) 70%, transparent 100%);
    z-index: 30;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }

  .player-top-bar.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .title-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    min-width: 0;
    overflow: hidden;
  }

  .playing-title {
    font-size: 1.05rem;
    font-weight: 800;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    text-align: center;
  }

  .playing-sub {
    font-size: 0.76rem;
    color: var(--theme-type-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    text-align: center;
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .queue-counter-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(30, 23, 40, 0.7);
    color: var(--text-secondary);
    padding: 6px 12px;
    border-radius: var(--radius-full);
    font-size: 0.78rem;
    font-weight: 600;
    border: 1px solid rgba(122, 107, 174, 0.25);
  }

  .queue-counter-btn:hover {
    background: rgba(60, 47, 82, 0.85);
    color: #fff;
  }

  .icon-btn-large {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(30, 23, 40, 0.7);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(122, 107, 174, 0.25);
    transition: all 0.2s ease;
  }

  .icon-btn-large:hover {
    background: rgba(60, 47, 82, 0.85);
    transform: scale(1.08);
  }

  .cast-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: var(--radius-full);
    font-size: 0.82rem;
    font-weight: 700;
    background: rgba(30, 23, 40, 0.7);
    color: #fff;
    border: 1px solid rgba(122, 107, 174, 0.25);
  }

  .cast-btn.active-cast {
    background: var(--theme-primary-accent);
    border-color: var(--theme-primary-accent);
    color: #050505;
    box-shadow: 0 0 16px rgba(149, 255, 80, 0.4);
  }

  /* Movi Player Element Container */
  .movi-player-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: #000;
  }

  :global(movi-player) {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }

  .video-loading-box {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-secondary);
    background: #000;
  }

  .spinner {
    animation: spin 1s linear infinite;
    color: var(--theme-primary-accent);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Video Player Container */
  .video-player-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: #000;
  }

  .native-video-el {
    width: 100%;
    height: 100%;
    max-height: 100vh;
    object-fit: contain;
  }

  .audio-hud-container {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    overflow: hidden;
    background: #09060f;
  }

  .audio-bg-blur {
    position: absolute;
    inset: -60px;
    background-size: cover;
    background-position: center;
    -webkit-filter: blur(80px) brightness(0.18) saturate(1.4);
    filter: blur(80px) brightness(0.18) saturate(1.4);
    transform: scale(1.15);
    opacity: 0.7;
  }

  .audio-hud-overlay-gradient {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at center, rgba(149, 255, 80, 0.04) 0%, rgba(9, 6, 15, 0.95) 60%, #09060f 100%);
    pointer-events: none;
    z-index: 2;
  }

  .audio-card {
    position: relative;
    z-index: 10;
    max-width: 440px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    background: #191424;
    border: 1px solid rgba(122, 107, 174, 0.35);
    border-radius: var(--radius-xl);
    padding: 32px 28px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.95);
  }

  .audio-artwork-wrapper {
    width: 220px;
    height: 220px;
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid rgba(122, 107, 174, 0.25);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7);
  }

  .audio-artwork {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .audio-placeholder {
    width: 100%;
    height: 100%;
    background: var(--theme-background-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--theme-primary-accent);
  }

  .audio-meta {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .audio-title-fav-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .audio-title {
    font-size: 1.35rem;
    font-weight: 800;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
    text-align: center;
  }

  .fav-btn-round {
    padding: 6px;
    border-radius: 50%;
    color: var(--text-muted);
    transition: all 0.15s ease;
  }

  .fav-btn-round:hover {
    color: #fff;
  }

  .fav-btn-round.active-fav {
    color: #ff5252;
  }

  .audio-artist {
    font-size: 0.95rem;
    color: var(--theme-primary-accent-hover);
    font-weight: 600;
  }

  .audio-album {
    font-size: 0.8rem;
    color: var(--theme-type-muted);
  }

  .next-up-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--theme-primary-accent);
    background: rgba(149, 255, 80, 0.12);
    border: 1px solid rgba(149, 255, 80, 0.3);
    padding: 4px 12px;
    border-radius: var(--radius-full);
    margin-top: 4px;
    align-self: center;
  }

  :global(.zap-icon) {
    animation: zapPulse 1.5s infinite ease-in-out;
  }

  @keyframes zapPulse {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.2); opacity: 1; }
  }

  .audio-scrubber-box {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .scrubber-range {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: var(--radius-full);
    outline: none;
    cursor: pointer;
    accent-color: var(--theme-primary-accent);
  }

  .time-display {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--theme-type-muted);
    font-family: var(--font-mono);
  }

  .audio-controls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0 8px;
  }

  .mode-icon-btn {
    padding: 8px;
    border-radius: 50%;
    color: var(--text-muted);
    background: transparent;
    transition: all 0.15s ease;
  }

  .mode-icon-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .mode-icon-btn.active-mode {
    color: var(--theme-primary-accent);
    background: rgba(149, 255, 80, 0.15);
  }

  .control-icon-btn {
    color: #fff;
    padding: 10px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    transition: all 0.15s ease;
  }

  .control-icon-btn:hover {
    color: var(--theme-primary-accent);
    background: rgba(255, 255, 255, 0.15);
  }

  .play-toggle-btn-large {
    width: 58px;
    height: 58px;
    border-radius: 50%;
    background: var(--theme-primary-accent);
    color: #050505;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 24px rgba(149, 255, 80, 0.4);
    transition: transform 0.15s ease;
  }

  .play-toggle-btn-large:hover {
    transform: scale(1.08);
  }

  /* Cast HUD */
  .cast-hud-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 28px;
    padding: 32px 20px;
  }

  .cast-poster-card {
    position: relative;
    width: 190px;
    aspect-ratio: 2 / 3;
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.85);
    border: 1px solid rgba(122, 107, 174, 0.25);
  }

  .cast-hud-poster {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cast-status-card {
    background: rgba(29, 23, 40, 0.85);
    border: 1px solid rgba(122, 107, 174, 0.25);
    border-radius: var(--radius-lg);
    padding: 26px 30px;
    max-width: 480px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .cast-signal-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .tv-icon-wrapper {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-md);
    background: rgba(149, 255, 80, 0.15);
    border: 1px solid rgba(149, 255, 80, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--theme-primary-accent);
  }

  .radar-pulse {
    position: absolute;
    inset: -6px;
    border-radius: var(--radius-md);
    border: 2px solid var(--theme-primary-accent);
    animation: radarPulse 2s infinite;
    opacity: 0;
  }

  @keyframes radarPulse {
    0% { transform: scale(0.9); opacity: 0.8; }
    100% { transform: scale(1.3); opacity: 0; }
  }

  .signal-details h4 {
    font-size: 1.05rem;
    font-weight: 800;
    color: #fff;
  }

  .signal-url {
    font-size: 0.74rem;
    color: var(--theme-type-muted);
    font-family: var(--font-mono);
    word-break: break-all;
    margin-top: 2px;
  }

  .cast-actions-row {
    display: flex;
    gap: 10px;
  }

  .cast-actions-row button {
    flex: 1;
  }

  /* Audio Quick Action Bar */
  .audio-quick-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid rgba(122, 107, 174, 0.2);
  }

  .quick-bar-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: var(--radius-full);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-secondary);
    background: rgba(30, 23, 40, 0.7);
    border: 1px solid rgba(122, 107, 174, 0.25);
    transition: all 0.15s ease;
  }

  .quick-bar-btn:hover {
    color: #fff;
    background: rgba(60, 47, 82, 0.85);
    border-color: var(--theme-primary-accent);
  }

  .quick-bar-btn:active {
    transform: scale(0.96);
  }

  @media (max-width: 768px) {
    .player-top-bar {
      padding: 12px 14px;
      gap: 8px;
    }
    .playing-title {
      font-size: 0.88rem;
    }
    .playing-sub {
      font-size: 0.68rem;
    }
    .cast-text {
      display: none;
    }
    .audio-hud-container {
      padding: 68px 14px 24px;
    }
    .audio-card {
      max-width: 100%;
      padding: 18px 14px;
      gap: 12px;
    }
    .audio-artwork-wrapper {
      width: 150px;
      height: 150px;
    }
    .audio-title {
      font-size: 1.05rem;
    }
    .audio-artist {
      font-size: 0.82rem;
    }
    .audio-album {
      font-size: 0.70rem;
    }
    .play-toggle-btn-large {
      width: 48px;
      height: 48px;
    }
    .quick-bar-btn {
      padding: 6px 10px;
      font-size: 0.72rem;
    }
  }
</style>
