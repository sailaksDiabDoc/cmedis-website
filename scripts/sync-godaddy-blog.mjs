// Syncs new posts from the GoDaddy "Websites + Marketing" blog into this site's /blog.
// Run: node scripts/sync-godaddy-blog.mjs
//
// How it works:
//  1. Fetch the GoDaddy blog sitemap to discover post URLs.
//  2. Diff against blog/posts.json (the manifest of already-imported posts).
//  3. For each new post, fetch its page and parse the embedded `window._BLOG_DATA`
//     JSON payload (title, date, featured image, and a Draft.js-style content
//     block list) that GoDaddy's site builder ships in every post's HTML.
//  4. Convert those blocks into HTML matching this site's article template,
//     write a new blog/<slug>.html page, and regenerate the auto-generated
//     card regions in index.html and blog/index.html.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SITEMAP_URL = 'https://cmedis.godaddysites.com/sitemap.blog.xml';
const MANIFEST_PATH = path.join(ROOT, 'blog', 'posts.json');
const HOMEPAGE_PATH = path.join(ROOT, 'index.html');
const BLOG_INDEX_PATH = path.join(ROOT, 'blog', 'index.html');
const MARKER_START = '<!-- AUTO-GENERATED-POSTS-START -->';
const MARKER_END = '<!-- AUTO-GENERATED-POSTS-END -->';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'cmedis-blog-sync/1.0' } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

function parseSitemapUrls(xml) {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)];
  return matches.map((m) => m[1].trim()).filter((u) => u.includes('/f/'));
}

// Extracts the `window._BLOG_DATA = {...};` JSON object from a post page's HTML
// by scanning for the balanced closing brace (regex alone can't handle nested
// braces/strings reliably).
function extractBlogData(html) {
  const marker = 'window._BLOG_DATA=';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('window._BLOG_DATA not found in page');
  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const jsonStr = html.slice(jsonStart, i + 1);
        return JSON.parse(jsonStr);
      }
    }
  }
  throw new Error('Could not find balanced end of window._BLOG_DATA JSON');
}

// Ratio of a Draft.js block's text length covered by inline style ranges of a given style.
function styleCoverage(block, styleName) {
  const ranges = (block.inlineStyleRanges || []).filter((r) => r.style === styleName);
  const covered = ranges.reduce((sum, r) => sum + r.length, 0);
  return block.text.length ? covered / block.text.length : 0;
}

function totalStyleCoverage(block) {
  const ranges = block.inlineStyleRanges || [];
  if (!ranges.length) return 0;
  // Merge overlapping ranges to avoid double-counting.
  const sorted = [...ranges].sort((a, b) => a.offset - b.offset);
  let covered = 0;
  let curStart = null;
  let curEnd = null;
  for (const r of sorted) {
    const start = r.offset;
    const end = r.offset + r.length;
    if (curStart === null) {
      curStart = start;
      curEnd = end;
    } else if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      covered += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  if (curStart !== null) covered += curEnd - curStart;
  return block.text.length ? covered / block.text.length : 0;
}

// Renders one block's text with <strong>/<em> spans applied per inlineStyleRanges,
// HTML-escaping the raw text and converting embedded newlines to <br>.
function renderInline(block) {
  const text = block.text || '';
  const ranges = block.inlineStyleRanges || [];
  if (!ranges.length) return escapeHtml(text).replace(/\n/g, '<br>');

  const boundaries = new Set([0, text.length]);
  ranges.forEach((r) => {
    boundaries.add(r.offset);
    boundaries.add(r.offset + r.length);
  });
  const points = [...boundaries].sort((a, b) => a - b);

  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segStart === segEnd) continue;
    const segment = text.slice(segStart, segEnd);
    const bold = ranges.some((r) => r.style === 'BOLD' && r.offset <= segStart && r.offset + r.length >= segEnd);
    const italic = ranges.some((r) => r.style === 'ITALIC' && r.offset <= segStart && r.offset + r.length >= segEnd);
    let piece = escapeHtml(segment).replace(/\n/g, '<br>');
    if (italic) piece = `<em>${piece}</em>`;
    if (bold) piece = `<strong>${piece}</strong>`;
    html += piece;
  }
  return html;
}

function blocksToHtml(blocks) {
  let html = '';
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === 'atomic') { i++; continue; } // images: skip, cover image is used instead

    if (block.type === 'unordered-list-item' || block.type === 'ordered-list-item') {
      const tag = block.type === 'unordered-list-item' ? 'ul' : 'ol';
      const cls = tag === 'ul' ? ' class="check-list"' : '';
      let items = '';
      while (i < blocks.length && blocks[i].type === block.type) {
        items += `<li>${renderInline(blocks[i])}</li>\n`;
        i++;
      }
      html += `<${tag}${cls}>\n${items}</${tag}>\n`;
      continue;
    }

    if (block.type === 'unstyled' && block.text.trim()) {
      const boldRatio = styleCoverage(block, 'BOLD');
      const isHeading = boldRatio > 0.85 && block.text.length < 100 && !block.text.includes('\n');
      if (isHeading) {
        html += `<h2>${escapeHtml(block.text)}</h2>\n`;
      } else {
        html += `<p>${renderInline(block)}</p>\n`;
      }
    }
    i++;
  }
  return html;
}

function pickExcerpt(blocks) {
  for (const block of blocks) {
    if (block.type !== 'unstyled') continue;
    if (totalStyleCoverage(block) > 0.85) continue; // heading/byline-like, skip
    const text = block.text.trim();
    if (text.length < 80) continue;
    return text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, '') + '…' : text;
  }
  return '';
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

function buildPostPage({ title, dateDisplay, contentHtml, featuredImage, godaddyUrl, slug }) {
  const coverHtml = featuredImage
    ? `<img src="${escapeHtml(featuredImage)}" alt="${escapeHtml(title)}">`
    : `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22"/></svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} | C-MEDiS Blog</title>
<meta name="description" content="${escapeHtml(title)} — from Dr. Sai Lakshmikanth Bharathi, C-MEDiS Chennai.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../css/styles.css">
</head>
<body>

<a href="#main" class="skip-link">Skip to main content</a>

<!-- ============ HEADER ============ -->
<header class="site-header" id="top">
  <div class="container header-inner">
    <a href="../index.html" class="brand">
      <img src="../assets/images/logo.png" alt="C-MEDiS logo" class="brand-logo" onerror="this.style.display='none'">
      <span class="brand-text">
        <strong>C-MEDiS</strong>
        <small>Metabolic · Endocrine · Diabetes · Infectious &amp; Sleep Clinic</small>
      </span>
    </a>

    <nav class="main-nav" id="mainNav">
      <a href="../index.html#about">About</a>
      <a href="../index.html#services">Services</a>
      <a href="../index.html#locations">Locations</a>
      <a href="../index.html#testimonials">Testimonials</a>
      <a href="index.html">Blog</a>
      <a href="../index.html#contact">Contact</a>
    </nav>

    <div class="header-actions">
      <a href="tel:+919840345363" class="btn btn-primary btn-sm">Call to Book</a>
      <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</header>

<!-- ============ POST ============ -->
<section class="section" id="main">
  <div class="container post-article">
    <a href="index.html" class="breadcrumb">&larr; Back to Blog</a>

    <div class="article-cover" aria-hidden="true" style="border-radius: var(--radius-lg); margin-bottom: 2rem;">
      ${coverHtml}
    </div>

    <h1>${escapeHtml(title)}</h1>
    <p class="post-meta">By Dr. Sai Lakshmikanth Bharathi, MD${dateDisplay ? ' &middot; ' + dateDisplay : ''}</p>

    <div class="article-full">
${contentHtml}    </div>

    <div class="article-actions">
      <a href="index.html" class="article-readmore">&larr; Back to Blog</a>
      ${godaddyUrl ? `<a href="${escapeHtml(godaddyUrl)}" target="_blank" rel="noopener" class="article-link">View Original Post &rarr;</a>` : ''}
    </div>
  </div>
</section>

<!-- ============ CONTACT / FOOTER ============ -->
<footer class="site-footer" id="contact">
  <div class="container footer-inner">
    <div class="footer-brand">
      <img src="../assets/images/logo.png" alt="C-MEDiS logo" class="footer-logo" onerror="this.style.display='none'">
      <p><strong>C-MEDiS</strong><br>Metabolic, Endocrine, Diabetes, Infectious &amp; Sleep Clinic — Chennai</p>
    </div>
    <div class="footer-col">
      <h3>Kovilambakkam</h3>
      <p>1/512, S. Kolathur, Sathya Nagar,<br>Viduthalai Nagar, Kovilambakkam,<br>Chennai, Tamil Nadu 600129</p>
      <a href="tel:+919840345363">98403 45363</a>
    </div>
    <div class="footer-col">
      <h3>Alandur</h3>
      <p>SB Speciality Clinic,<br>Old No. 48, New No. 91,<br>Ekambaram Daffedar St, Alandur,<br>Chennai, Tamil Nadu 600016</p>
      <a href="tel:+919342297922">93422 97922</a>
    </div>
    <div class="footer-col">
      <h3>Quick Links</h3>
      <a href="../index.html#about">About</a>
      <a href="../index.html#services">Services</a>
      <a href="../index.html#locations">Locations</a>
      <a href="../index.html#testimonials">Testimonials</a>
      <a href="index.html">Blog</a>
    </div>
  </div>
  <div class="footer-bottom">
    <p>&copy; <span id="year"></span> C-MEDiS. All rights reserved.</p>
  </div>
</footer>

<!-- ============ CHATBOT WIDGET ============ -->
<div class="chatbot" id="chatbot">
  <button class="chatbot-toggle" id="chatbotToggle" aria-label="Open chat assistant">
    <svg viewBox="0 0 24 24" class="icon-chat"><path d="M4 4h16v12H8l-4 4z"/></svg>
    <svg viewBox="0 0 24 24" class="icon-close"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>

  <div class="chatbot-panel" id="chatbotPanel">
    <div class="chatbot-header">
      <strong>C-MEDiS Assistant</strong>
      <span>Ask about services, locations &amp; appointments</span>
    </div>
    <div class="chatbot-messages" id="chatbotMessages"></div>
    <div class="chatbot-suggestions" id="chatbotSuggestions"></div>
    <form class="chatbot-input" id="chatbotForm">
      <input type="text" id="chatbotInput" placeholder="Type your question..." autocomplete="off">
      <button type="submit" aria-label="Send">
        <svg viewBox="0 0 24 24"><path d="M3 12l18-9-6 9 6 9-18-9z"/></svg>
      </button>
    </form>
  </div>
</div>

<script src="../js/script.js"></script>
</body>
</html>
`;
}

function coverIconSvg(icon) {
  const icons = {
    trend: '<svg viewBox="0 0 64 64"><path d="M6 46 20 30l10 8 14-20 10 10" /><circle cx="50" cy="14" r="3" fill="currentColor" stroke="none"/><path d="M46 50c0 4 3 8 8 8s8-4 8-8-4-6-8-10c-4 4-8 6-8 10z"/></svg>',
    sensor: '<svg viewBox="0 0 64 64"><rect x="20" y="14" width="24" height="34" rx="4"/><path d="M26 14v-4h12v4M26 48h12"/><path d="M8 40c4-10 8-14 12-4M44 36c4-10 8-14 12-4"/></svg>',
  };
  return icons[icon] || '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22"/></svg>';
}

function buildCardHtml(post, hrefPrefix) {
  const coverInner = post.cover?.type === 'image'
    ? `<img src="${escapeHtml(post.cover.src)}" alt="${escapeHtml(post.title)}">`
    : coverIconSvg(post.cover?.icon);
  return `      <div class="article-card">
        <div class="article-cover" aria-hidden="true">
          ${coverInner}
        </div>
        <div class="article-body">
          <span class="article-tag">${escapeHtml(post.tag || 'C-MEDiS Blog')}</span>
          <h3>${escapeHtml(post.title)}</h3>
          <p class="article-excerpt">
            ${escapeHtml(post.excerpt)}
          </p>
          <div class="article-actions">
            <a href="${hrefPrefix}${post.page}" class="article-readmore">Read Article &rarr;</a>
          </div>
        </div>
      </div>`;
}

function replaceMarkedRegion(fileContent, newInner) {
  const startIdx = fileContent.indexOf(MARKER_START);
  const endIdx = fileContent.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Could not find AUTO-GENERATED-POSTS markers');
  }
  return (
    fileContent.slice(0, startIdx + MARKER_START.length) +
    '\n' + newInner + '\n' +
    fileContent.slice(endIdx)
  );
}

async function regenerateGrids(manifest) {
  const sorted = [...manifest].sort((a, b) => (a.date < b.date ? 1 : -1));

  const blogIndexHtml = await readFile(BLOG_INDEX_PATH, 'utf8');
  const allCards = sorted.map((p) => buildCardHtml(p, '')).join('\n\n');
  await writeFile(BLOG_INDEX_PATH, replaceMarkedRegion(blogIndexHtml, allCards), 'utf8');

  const homepageHtml = await readFile(HOMEPAGE_PATH, 'utf8');
  const latestTwoCards = sorted.slice(0, 2).map((p) => buildCardHtml(p, 'blog/')).join('\n\n');
  await writeFile(HOMEPAGE_PATH, replaceMarkedRegion(homepageHtml, latestTwoCards), 'utf8');
}

async function main() {
  const manifestRaw = await readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const knownSlugs = new Set(manifest.map((p) => p.slug));

  console.log(`Fetching sitemap: ${SITEMAP_URL}`);
  const sitemapXml = await fetchText(SITEMAP_URL);
  const postUrls = parseSitemapUrls(sitemapXml);
  console.log(`Found ${postUrls.length} post(s) in sitemap.`);

  let addedCount = 0;

  for (const url of postUrls) {
    const slug = url.split('/f/')[1]?.replace(/\/$/, '');
    if (!slug || knownSlugs.has(slug)) continue;

    console.log(`New post detected: ${slug} (${url})`);
    try {
      const html = await fetchText(url);
      const data = extractBlogData(html);
      const post = data.post;
      const fullContent = JSON.parse(post.fullContent);
      const blocks = fullContent.blocks || [];

      const title = (post.title || slug).trim().replace(/:\s*$/, '');
      const dateIso = post.publishedDate || post.date;
      const contentHtml = blocksToHtml(blocks);
      const excerpt = pickExcerpt(blocks) || title;
      const featuredImage = post.featuredImage ? (post.featuredImage.startsWith('http') ? post.featuredImage : `https:${post.featuredImage}`) : '';

      const pageHtml = buildPostPage({
        title,
        dateDisplay: formatDate(dateIso),
        contentHtml,
        featuredImage,
        godaddyUrl: url,
        slug,
      });

      const pageFile = `${slug}.html`;
      await writeFile(path.join(ROOT, 'blog', pageFile), pageHtml, 'utf8');

      manifest.push({
        slug,
        title,
        tag: 'From the Blog',
        excerpt,
        date: (dateIso || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
        source: 'godaddy',
        page: pageFile,
        godaddyUrl: url,
        cover: featuredImage ? { type: 'image', src: featuredImage } : { type: 'icon', icon: 'default' },
      });
      knownSlugs.add(slug);
      addedCount++;
      console.log(`  -> wrote blog/${pageFile}`);
    } catch (err) {
      console.error(`  !! Failed to import "${slug}": ${err.message}`);
      // Skip — will be retried on the next scheduled run.
    }
  }

  if (addedCount > 0) {
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await regenerateGrids(manifest);
    console.log(`Imported ${addedCount} new post(s). Grids regenerated.`);
  } else {
    console.log('No new posts. Nothing to do.');
  }
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
