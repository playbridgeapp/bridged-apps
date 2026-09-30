<script lang="ts">
  export let loading = true;
</script>

<div class="title-skeleton" role="status">
  <div class="shapes" aria-hidden="true">
    <span class="eyebrow"></span><span class="title"></span><span class="title short"></span>
    <span class="facts"></span><span class="description"></span><span class="description short"></span>
  </div>
  <p>{loading ? 'Loading title details…' : 'Title details unavailable'}</p>
</div>

<style>
  .title-skeleton{width:min(100%,560px)}
  .shapes{display:flex;flex-direction:column;gap:16px}
  .shapes span{display:block;max-width:100%;border-radius:8px;background:linear-gradient(110deg,#ffffff08 10%,#ffffff15 50%,#ffffff08 90%);background-size:200% 100%;animation:shimmer 1.7s ease-in-out infinite}
  .eyebrow{width:100px;height:12px;margin-bottom:8px}
  .title{width:440px;height:clamp(32px,5vw,58px)}
  .title.short{width:280px}
  .facts{width:230px;height:18px;margin:12px 0}
  .description{width:520px;height:14px}
  .description.short{width:360px}
  p{margin:22px 0 0;color:#99a7b5;font-size:13px}
  @keyframes shimmer{to{background-position-x:-200%}}
  @media(prefers-reduced-motion:reduce){.shapes span{animation:none}}
</style>
