import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const GALLERY_COUNT = 12;
const HOME_GALLERY_MARKER = '<section class="section dark" style="padding:0">';
const HOURS_MARKER = '<section class="section dark"><div class="shell hours-layout">';
const STORY_ART_MARKER = '<div class="mirror-art" aria-hidden="true"></div>';
const HERO_ART_PATTERN = /<div class="studio-art" aria-hidden="true">[\s\S]*?<div class="counter"><\/div><\/div>/;

const imageCache = new Map<number, Promise<string | null>>();

function candidatePaths(index: number): string[] {
  const fileName = `gallery-${String(index).padStart(2, '0')}.b64`;
  return [
    join(process.cwd(), 'apps/sites/public/bare-beauty', fileName),
    join(process.cwd(), 'public/bare-beauty', fileName),
    join(process.cwd(), 'apps/sites/dist/client/bare-beauty', fileName),
    join(process.cwd(), 'dist/client/bare-beauty', fileName),
  ];
}

async function readGalleryImage(index: number): Promise<string | null> {
  const cached = imageCache.get(index);
  if (cached) return cached;

  const pending = (async () => {
    for (const path of candidatePaths(index)) {
      try {
        const encoded = (await readFile(path, 'utf8')).trim();
        if (encoded && /^[A-Za-z0-9+/=]+$/.test(encoded)) {
          return `data:image/webp;base64,${encoded}`;
        }
      } catch {
        // Try the next production/test path. Missing imagery must never break rendering.
      }
    }
    return null;
  })();

  imageCache.set(index, pending);
  return pending;
}

const RESULT_ALTS = [
  'Bare Beauty Keighley brow styling result',
  'Bare Beauty Keighley defined brow treatment result',
  'Professional brow mapping at Bare Beauty Keighley',
  'Defined brow and lifted lash result at Bare Beauty Keighley',
  'Bare Beauty Keighley brow treatment in progress',
  'Natural brow and lash treatment result at Bare Beauty Keighley',
  'Bare Beauty Keighley precision brow styling result',
  'Natural lash lift result at Bare Beauty Keighley',
  'Bare Beauty Keighley brow and lash finish',
  'Detailed brow styling result at Bare Beauty Keighley',
];

function gallerySection(images: Array<string | null>): string {
  const cards = images.slice(0, 10).map((src, index) => {
    if (!src) return '';
    return `<figure class="bb-gallery-card bb-reveal"><img src="${src}" alt="${RESULT_ALTS[index]}" loading="lazy" decoding="async"><figcaption>${index === 2 || index === 4 ? 'Behind the treatment' : 'Real Bare Beauty result'}</figcaption></figure>`;
  }).join('');

  if (!cards) return '';

  return `<section class="section bb-gallery-section" aria-labelledby="bb-real-work-title"><div class="shell"><div class="section-head center bb-reveal"><p class="eyebrow">Real work · Real results</p><h2 id="bb-real-work-title">Brows and lashes, finished with intention.</h2><p class="section-copy" style="margin-inline:auto">A closer look at real Bare Beauty treatments — from precise brow mapping and faith-conscious brow work to polished lash finishes.</p></div><div class="bb-gallery-grid">${cards}</div></div></section>`;
}

function studioSection(images: Array<string | null>): string {
  const first = images[10];
  const second = images[11];
  if (!first && !second) return '';

  const media = [
    first ? `<figure class="bb-studio-photo bb-reveal"><img src="${first}" alt="Bare Beauty Keighley professional brow and lash products" loading="lazy" decoding="async"></figure>` : '',
    second ? `<figure class="bb-studio-photo bb-reveal"><img src="${second}" alt="Bare Beauty Keighley treatment tools and products" loading="lazy" decoding="async"></figure>` : '',
  ].join('');

  return `<section class="section soft bb-studio-section"><div class="shell bb-studio-grid"><div class="bb-studio-copy bb-reveal"><p class="eyebrow">Thoughtful treatment details</p><h2>Professional tools. Considered products. Personal care.</h2><p class="section-copy">Every appointment is prepared around the treatment being delivered, with dedicated brow and lash tools, careful mapping and product choices designed for a precise, polished finish.</p><p class="muted">Your treatment is always tailored to your features, preferences and the condition of your natural brows or lashes.</p></div><div class="bb-studio-photos">${media}</div></div></section>`;
}

const MOTION_STYLES = `<style id="bb-real-gallery-styles">
  .bb-hero-media{position:relative;min-height:620px;margin:0;overflow:hidden;background:#3a2b24;isolation:isolate}.bb-hero-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;transition:transform 1.1s cubic-bezier(.2,.7,.2,1)}.bb-hero-media:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(24,18,15,.02),rgba(24,18,15,.28));z-index:1;pointer-events:none}.bb-hero-caption{position:absolute;left:28px;bottom:26px;z-index:2;padding:11px 14px;background:rgba(255,253,249,.9);backdrop-filter:blur(12px);font-size:.64rem;text-transform:uppercase;letter-spacing:.18em;font-weight:800;color:#49382f;border:1px solid rgba(255,255,255,.4)}
  .bb-story-media{margin:0;min-height:480px;overflow:hidden;background:#d9c4b4}.bb-story-media img{width:100%;height:100%;min-height:480px;display:block;object-fit:cover;object-position:center;transition:transform .9s cubic-bezier(.2,.7,.2,1)}
  .bb-gallery-section{background:#fffdf9}.bb-gallery-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.bb-gallery-card{position:relative;margin:0;aspect-ratio:4/5;overflow:hidden;background:#eadfd5;box-shadow:0 12px 32px rgba(61,42,32,.08)}.bb-gallery-card:nth-child(5n+1){grid-column:span 2;aspect-ratio:8/5}.bb-gallery-card img{display:block;width:100%;height:100%;object-fit:cover;object-position:center;transition:transform .8s cubic-bezier(.2,.7,.2,1),filter .4s}.bb-gallery-card figcaption{position:absolute;left:12px;bottom:12px;padding:8px 10px;background:rgba(255,253,249,.88);backdrop-filter:blur(9px);font-size:.58rem;text-transform:uppercase;letter-spacing:.14em;font-weight:800;color:#47372f;opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s}.bb-gallery-card:hover img{transform:scale(1.045)}.bb-gallery-card:hover figcaption{opacity:1;transform:none}
  .bb-studio-grid{display:grid;grid-template-columns:.82fr 1.18fr;gap:58px;align-items:center}.bb-studio-copy h2{font-size:clamp(2.4rem,4.3vw,4rem);line-height:1.02;margin:0 0 24px}.bb-studio-photos{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch}.bb-studio-photo{margin:0;min-height:460px;overflow:hidden;background:#eee4da}.bb-studio-photo:nth-child(2){margin-top:52px;margin-bottom:-52px}.bb-studio-photo img{width:100%;height:100%;min-height:460px;display:block;object-fit:cover;transition:transform .8s cubic-bezier(.2,.7,.2,1)}.bb-studio-photo:hover img,.bb-story-media:hover img,.bb-hero-media:hover img{transform:scale(1.035)}
  @media(max-width:980px){.bb-gallery-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bb-gallery-card:nth-child(5n+1){grid-column:span 2}.bb-studio-grid{grid-template-columns:1fr}.bb-studio-photos{max-width:760px}.bb-studio-photo{min-height:380px}.bb-studio-photo img{min-height:380px}}
  @media(max-width:650px){.bb-hero-media{min-height:430px}.bb-gallery-grid{grid-template-columns:1fr;gap:12px}.bb-gallery-card,.bb-gallery-card:nth-child(5n+1){grid-column:auto;aspect-ratio:4/5}.bb-gallery-card figcaption{opacity:1;transform:none}.bb-studio-photos{grid-template-columns:1fr 1fr;gap:10px}.bb-studio-photo,.bb-studio-photo img{min-height:290px}.bb-studio-photo:nth-child(2){margin-top:28px;margin-bottom:-28px}.bb-story-media,.bb-story-media img{min-height:390px}}
  @media(prefers-reduced-motion:no-preference){html.bb-motion .bb-reveal{opacity:0;transform:translateY(26px);transition:opacity .72s cubic-bezier(.2,.7,.2,1),transform .72s cubic-bezier(.2,.7,.2,1);transition-delay:var(--bb-delay,0ms);will-change:opacity,transform}html.bb-motion .bb-reveal.is-visible{opacity:1;transform:none}.bb-hero-media img{animation:bbHeroDrift 15s ease-in-out infinite alternate}@keyframes bbHeroDrift{from{transform:scale(1.01)}to{transform:scale(1.055)}}}
  @media(prefers-reduced-motion:reduce){.bb-hero-media img,.bb-gallery-card img,.bb-studio-photo img,.bb-story-media img,.service-card,.btn{animation:none!important;transition:none!important}.bb-reveal{opacity:1!important;transform:none!important}}
</style>`;

const MOTION_SCRIPT = `<script id="bb-real-gallery-motion">(()=>{const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduce)return;const selectors=['.hero-copy','.bb-hero-media','.section-head','.service-card','.value','.story','.bb-story-media','.step','.notice','.hours-layout>div','.detail-grid>article','.detail-sidebar','.category-block','.contact-card','.legal-card','.bb-reveal'];const nodes=[...new Set(selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector))))];document.documentElement.classList.add('bb-motion');nodes.forEach((node,index)=>{node.classList.add('bb-reveal');node.style.setProperty('--bb-delay',String((index%6)*65)+'ms')});if(!('IntersectionObserver'in window)){nodes.forEach(node=>node.classList.add('is-visible'));return}const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.08});requestAnimationFrame(()=>nodes.forEach(node=>observer.observe(node)))})();</script>`;

export async function enhanceBareBeautyHtml(html: string): Promise<string> {
  if (!html.includes('</head>') || !html.includes('</body>')) return html;

  const images = await Promise.all(
    Array.from({ length: GALLERY_COUNT }, (_, index) => readGalleryImage(index + 1)),
  );

  let enhanced = html.replace('</head>', `${MOTION_STYLES}</head>`);

  if (enhanced.includes('<section class="hero">')) {
    const hero = images[7] || images[0] || images.find(Boolean) || null;
    if (hero) {
      enhanced = enhanced.replace(HERO_ART_PATTERN, `<figure class="bb-hero-media bb-reveal"><img src="${hero}" alt="Bare Beauty Keighley brow and lash treatment result" loading="eager" decoding="async" fetchpriority="high"><figcaption class="bb-hero-caption">Real work · Bare Beauty Keighley</figcaption></figure>`);
    }

    const story = images[8] || images[1] || images.find(Boolean) || null;
    if (story) {
      enhanced = enhanced.replace(STORY_ART_MARKER, `<figure class="bb-story-media bb-reveal"><img src="${story}" alt="Bare Beauty Keighley natural brow and lash result" loading="lazy" decoding="async"></figure>`);
    }

    const gallery = gallerySection(images);
    if (gallery && enhanced.includes(HOME_GALLERY_MARKER)) {
      enhanced = enhanced.replace(HOME_GALLERY_MARKER, `${gallery}${HOME_GALLERY_MARKER}`);
    }

    const studio = studioSection(images);
    if (studio && enhanced.includes(HOURS_MARKER)) {
      enhanced = enhanced.replace(HOURS_MARKER, `${studio}${HOURS_MARKER}`);
    }
  }

  return enhanced.replace('</body>', `${MOTION_SCRIPT}</body>`);
}
