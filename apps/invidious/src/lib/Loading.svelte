<script lang="ts">
  import { LoaderCircle } from 'lucide-svelte';
  let { label = 'Loading…' }: { label?: string } = $props();
</script>

<div class="loading" role="status"><LoaderCircle size={18} class="spin" />{label}</div>
