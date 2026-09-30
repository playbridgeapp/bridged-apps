<script lang="ts">
  import MediaTile from './MediaTile.svelte';
  import { Play } from 'lucide-svelte';
  import type { Meta, MetaPreview, MetaTrailer } from './types';
  export let meta: Meta;
  export let onSelect: (preview: MetaPreview) => void;
  export let onTrailer: (trailer: MetaTrailer) => void;
</script>

{#if meta.people?.length}
  <section class="detail-section" aria-label="Cast"><div class="section-heading"><div><span class="section-type">THE PEOPLE</span><h2>Cast</h2></div></div><div class="people-rail">{#each meta.people.slice(0, 16) as person}<div class="person-card"><div class="person-art">{#if person.photo}<img src={person.photo} alt={person.name} loading="lazy" />{:else}<span>{person.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>{/if}</div><strong>{person.name}</strong>{#if person.character}<small>{person.character}</small>{/if}</div>{/each}</div></section>
{/if}
{#if meta.trailers?.length}
  <section class="detail-section" aria-label="Trailers"><div class="section-heading"><div><span class="section-type">TAKE A LOOK</span><h2>Trailers</h2></div></div><div class="trailers-rail">{#each meta.trailers as trailer}<button class="trailer-card" onclick={() => onTrailer(trailer)} aria-label={`Play ${trailer.name}`}><div><img src={trailer.thumbnail} alt="" loading="lazy" /><span><Play size={24} fill="currentColor" /></span></div><strong>{trailer.name}</strong><small>Play trailer</small></button>{/each}</div></section>
{/if}
{#each [{ title: 'Production companies', items: meta.productionCompanies }, { title: 'Networks', items: meta.networks }] as group}
  {#if group.items?.length}<section class="detail-section" aria-label={group.title}><div class="section-heading"><h2>{group.title}</h2></div><div class="company-list">{#each group.items as company}<div class="company-card">{#if company.logo}<div class="company-logo"><img src={company.logo} alt="" loading="lazy" /></div>{/if}<strong>{company.name}</strong></div>{/each}</div></section>{/if}
{/each}
{#if meta.collectionItems?.length}
  <section class="detail-section" aria-label="Movie collection"><div class="section-heading"><div><span class="section-type">THE COLLECTION</span><h2>{meta.collectionName || 'Movie collection'}</h2></div></div><div class="media-row">{#each meta.collectionItems as item (item.id)}<MediaTile {item} onSelect={() => onSelect(item)} />{/each}</div></section>
{/if}
{#if meta.moreLikeThis?.length}
  <section class="detail-section" aria-label="More like this"><div class="section-heading"><div><span class="section-type">FROM TMDB</span><h2>More like this</h2></div></div><div class="media-row">{#each meta.moreLikeThis as item (item.type + item.id)}<MediaTile {item} onSelect={() => onSelect(item)} />{/each}</div></section>
{/if}

<style>
  .people-rail,.trailers-rail{display:flex;gap:18px;overflow-x:auto;scrollbar-width:none;padding-bottom:12px}.people-rail::-webkit-scrollbar,.trailers-rail::-webkit-scrollbar{display:none}
  .person-card{width:125px;flex:none}.person-art{height:166px;overflow:hidden;border-radius:12px;background:#ffffff09;display:grid;place-items:center;margin-bottom:12px}
  .person-art img{width:100%;height:100%;object-fit:cover}.person-art span{font-size:26px;color:#a8c7bd}
  strong{display:block;color:#edf1ef;font-size:13px;line-height:1.5}small{display:block;font-size:11px;color:#94a4ad;line-height:1.6;margin-top:3px}
  .trailer-card{flex:none;width:260px;text-align:left;padding:0;border:0;background:none;font:inherit;cursor:pointer}.trailer-card:focus-visible{outline:2px solid #86d5bd;outline-offset:5px;border-radius:12px}.trailer-card>div{position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:12px;background:#ffffff09;margin-bottom:12px}
  .trailer-card img{width:100%;height:100%;object-fit:cover}.trailer-card span{position:absolute;inset:0;display:grid;place-items:center;color:#fff;background:#0003;transition:background .2s}
  .trailer-card:hover span{background:#0001}.company-list{display:flex;flex-wrap:wrap;gap:12px}.company-card{padding:15px 20px;border:1px solid #ffffff1f;border-radius:12px;background:#ffffff06;max-width:200px}
  .company-logo{height:44px;display:flex;align-items:center;margin-bottom:10px}.company-logo img{max-width:160px;max-height:44px;object-fit:contain}
  @media(max-width:800px){.person-card{width:105px}.person-art{height:140px}.people-rail,.trailers-rail{gap:12px}.trailer-card{width:225px}}
</style>
