<script lang="ts">
  let { message, retry }: { message: string; retry?: () => void } = $props();
</script>

<div class="notice error" role="alert">
  {message}
  {#if retry}<div><button class="btn small" onclick={retry}>Try again</button></div>{/if}
</div>
