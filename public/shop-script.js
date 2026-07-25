'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let products      = [];
let soldCounts    = {};
let cart          = [];
let activeP       = null;
let selectedSize  = '';
let selectedColor = '';
let selectedTierQty = 2;
let curCat        = 'All';
let curSort       = 'Relevance';
let _cartJustOpened = false;
let _navDropdownOpen = false;
let _navCloseTimeoutId = null;
let vantaEffect   = null;

const NAV_STAGGER_DELAY = 70;
const NAV_ITEM_DURATION = 420;

const SALE_TIMER_DURATION_MS = 4 * 60 * 60 * 1000;
const SALE_TIMER_STORAGE_KEY = 'hss_sale_timer_end';
let _saleTimerIntervalId = null;

function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#x27;')
        .replace(/\//g, '&#x2F;');
}

async function loadProducts() {
    try {
        const res  = await fetch('/api/products');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        products = data.map((p) => ({
            ...p,
            id:       p.slug,
            name:     p.title,
            price:    `$${p.priceUSD.toFixed(2)} USD`,
            pVal:     p.priceUSD,
            tier2Total: typeof p.priceTier2Total === 'number' ? p.priceTier2Total : null,
            tier3Total: typeof p.priceTier3Total === 'number' ? p.priceTier3Total : null,
            cat:      p.category,
            imgs:     p.images && p.images.length ? p.images : ['/assets/images/placeholder.png'],
            sizes:    p.sizes  && p.sizes.length  ? p.sizes  : ['NA'],
            colors:   p.colors && p.colors.length ? p.colors : ['NA'],
            colorMap: {},
            remaining: typeof p.quantityRemaining === 'number' ? p.quantityRemaining : 0,
        }));
    } catch (err) {
        console.error('Failed to load products:', err);
        products = [];
    }
}

async function loadSoldCounts() {
    try {
        const res  = await fetch('/api/sold-counts');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        soldCounts = await res.json();
    } catch (err) {
        console.warn('Could not load sold counts:', err.message);
        soldCounts = {};
    }
}

async function loadAuthStatus() {
    const picEl = document.getElementById('nav-profile-pic');
    try {
        const res  = await fetch('/api/auth-status');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (picEl && data.loggedIn && data.profilePic) {
            picEl.src = data.profilePic;
        }
    } catch (err) {
        console.warn('Could not load auth status:', err.message);
    }
}

async function init() {
    vantaEffect = VANTA.CLOUDS({
        el: '#canvas-container',
        mouseControls: true,
        touchControls: false,
        gyroControls: false,
        backgroundColor: 0x0,
        skyColor:        0x111b24,
        cloudColor:      0x3a4a5e,
        speed:           1.2,
    });

    await Promise.all([loadProducts(), loadSoldCounts(), loadAuthStatus()]);

    buildFilterLists();
    setupSearch();
    setupCartOutsideClick();
    setupNavDropdownOutsideClick();
    setupPopState();
    setupCheckoutBfcacheReset();
    setupHeaderMarquee();
    setupSaleTimer();
    setupFooterScrollReveal();
    routeFromURL(false);
}

// ─── Sale countdown timer ─────────────────────────────────────────────────────
function getSaleTimerEnd() {
    const stored = localStorage.getItem(SALE_TIMER_STORAGE_KEY);
    const storedEnd = stored ? parseInt(stored, 10) : NaN;

    if (!isNaN(storedEnd) && storedEnd > Date.now()) {
        return storedEnd;
    }

    const newEnd = Date.now() + SALE_TIMER_DURATION_MS;
    localStorage.setItem(SALE_TIMER_STORAGE_KEY, String(newEnd));
    return newEnd;
}

function updateSaleTimerDisplay() {
    let endTime = getSaleTimerEnd();
    let remainingMs = endTime - Date.now();

    if (remainingMs <= 0) {
        endTime = Date.now() + SALE_TIMER_DURATION_MS;
        localStorage.setItem(SALE_TIMER_STORAGE_KEY, String(endTime));
        remainingMs = endTime - Date.now();
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const hrs = Math.floor(totalSeconds / 3600);
    const min = Math.floor((totalSeconds % 3600) / 60);
    const sec = totalSeconds % 60;

    const pad = (n) => String(n).padStart(2, '0');

    const hrsEl = document.getElementById('timer-hrs');
    const minEl = document.getElementById('timer-min');
    const secEl = document.getElementById('timer-sec');
    if (hrsEl) hrsEl.textContent = pad(hrs);
    if (minEl) minEl.textContent = pad(min);
    if (secEl) secEl.textContent = pad(sec);
}

/**
 * Instead of any CSS transform "spin" on the canvas (which looked like a
 * barrel roll and had nothing to do with Vanta's own rendering), this
 * dispatches a sequence of synthetic `mousemove` events sweeping in a
 * spiral path across the viewport. Vanta's built-in mouseControls already
 * listens for real mousemove events to drive its camera — this just feeds
 * it a scripted path so the SAME interactive camera movement you get from
 * moving your mouse happens automatically on click, with no fake CSS
 * animation layered on top. Works identically to genuine mouse movement,
 * so it respects whatever motion style Vanta already uses.
 */
function triggerVantaInteraction() {
    if (!vantaEffect) return;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.32;
    const duration = 1500;
    const loops = 1.75;
    const start = performance.now();

    function step(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const angle = progress * Math.PI * 2 * loops;
        const easeOut = 1 - Math.pow(1 - progress, 2);
        const currentRadius = radius * (1 - easeOut * 0.6); // spiral gently inward

        const x = centerX + Math.cos(angle) * currentRadius;
        const y = centerY + Math.sin(angle) * currentRadius;

        window.dispatchEvent(new MouseEvent('mousemove', {
            clientX: x,
            clientY: y,
            bubbles: true,
        }));

        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

function setupSaleTimer() {
    updateSaleTimerDisplay();
    if (_saleTimerIntervalId) clearInterval(_saleTimerIntervalId);
    _saleTimerIntervalId = setInterval(updateSaleTimerDisplay, 1000);

    const banner = document.getElementById('sale-timer-banner');
    const flashLayer = document.getElementById('sale-timer-flash-layer');
    if (!banner || !flashLayer) return;

    banner.addEventListener('click', (e) => {
        const rect = banner.getBoundingClientRect();
        const ripple = document.createElement('span');
        const size = Math.max(rect.width, rect.height) * 1.8;

        ripple.className = 'sale-timer-ripple';
        ripple.style.width = size + 'px';
        ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

        flashLayer.appendChild(ripple);
        setTimeout(() => ripple.remove(), 900);

        triggerVantaInteraction();
    });
}

// ─── Header marquee ───────────────────────────────────────────────────────────
function setupHeaderMarquee() {
    const track = document.getElementById('header-marquee-track');
    if (!track) return;

    const items = ['Stripe Secure Payment', '24/7 Support', 'Free Shipping', 'Fast Delivery', 'Fast Shipping'];
    const REPEATS = 8;

    let sequenceHTML = '';
    for (let r = 0; r < REPEATS; r++) {
        items.forEach(text => {
            sequenceHTML += `<span class="marquee-phrase">${escapeHTML(text)}</span>`;
        });
    }

    track.innerHTML = sequenceHTML + sequenceHTML;
}

// ─── Footer scroll-reveal ─────────────────────────────────────────────────────
function setupFooterScrollReveal() {
    const footer = document.getElementById('site-footer');
    if (!footer || !('IntersectionObserver' in window)) {
        if (footer) footer.classList.add('footer-visible');
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                footer.classList.add('footer-visible');
            } else {
                footer.classList.remove('footer-visible');
            }
        });
    }, { threshold: 0.1 });

    observer.observe(footer);
}

// ─── Checkout bfcache fix ──────────────────────────────────────────────────────
function setupCheckoutBfcacheReset() {
    window.addEventListener('pageshow', () => {
        const btn = document.getElementById('checkout-btn');
        if (!btn) return;
        btn.disabled = false;
        btn.textContent = 'CHECKOUT';
    });
}

// ─── Nav Dropdown ─────────────────────────────────────────────────────────────
function toggleNavDropdown() {
    if (_navDropdownOpen) {
        closeNavDropdown();
    } else {
        openNavDropdown();
    }
}

function openNavDropdown() {
    if (_navCloseTimeoutId) {
        clearTimeout(_navCloseTimeoutId);
        _navCloseTimeoutId = null;
    }

    const btn      = document.getElementById('nav-logo-btn');
    const dropdown = document.getElementById('nav-dropdown');
    const items    = Array.from(dropdown.querySelectorAll('.nav-dropdown-item'));

    _navDropdownOpen = true;
    btn.classList.remove('nav-btn-closing');
    btn.classList.add('nav-btn-open');
    btn.setAttribute('aria-expanded', 'true');

    dropdown.classList.remove('acme-hidden');
    dropdown.classList.add('nav-dropdown-open');

    items.forEach((item) => item.classList.remove('nav-item-visible'));
    void dropdown.offsetWidth;
    items.forEach((item) => {
        requestAnimationFrame(() => item.classList.add('nav-item-visible'));
    });
}

function closeNavDropdown() {
    const btn      = document.getElementById('nav-logo-btn');
    const dropdown = document.getElementById('nav-dropdown');
    const items    = Array.from(dropdown.querySelectorAll('.nav-dropdown-item'));

    _navDropdownOpen = false;
    btn.classList.remove('nav-btn-open');
    btn.classList.add('nav-btn-closing');
    btn.setAttribute('aria-expanded', 'false');

    items.forEach((item) => item.classList.remove('nav-item-visible'));
    dropdown.classList.remove('nav-dropdown-open');

    const total = items.length;
    const totalCascadeTime = (total - 1) * NAV_STAGGER_DELAY + NAV_ITEM_DURATION;
    _navCloseTimeoutId = setTimeout(() => {
        dropdown.classList.add('acme-hidden');
        btn.classList.remove('nav-btn-closing');
        _navCloseTimeoutId = null;
    }, totalCascadeTime);
}

function setupNavDropdownOutsideClick() {
    document.addEventListener('click', (e) => {
        if (!_navDropdownOpen) return;
        if (e.target.closest('.nav-logo-wrapper')) return;
        closeNavDropdown();
    });
}

function navigateToStore(e) {
    e.preventDefault();
    closeNavDropdown();
    history.pushState({}, '', '/shop');
    document.getElementById('shop-view').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('shop-view').classList.add('acme-hidden');
        const intro = document.getElementById('intro-view');
        intro.style.display = 'flex';
        intro.style.opacity = '1';
    }, 400);
    return false;
}

// ─── URL Router ───────────────────────────────────────────────────────────────
function routeFromURL(animate) {
    const p = window.location.pathname;

    const slugMatch = p.match(/^\/shop\/collections\/([a-z0-9-]+)$/);
    if (slugMatch) {
        showShopViewImmediate();
        openPDPBySlug(slugMatch[1], false);
        return;
    }

    if (p === '/shop/collections') {
        if (animate) {
            showShopView(() => showCollections());
        } else {
            showShopViewImmediate();
            showCollections();
        }
        return;
    }

    showIntroView();
}

function setupPopState() {
    window.addEventListener('popstate', () => routeFromURL(true));
}

function showIntroView() {
    const intro = document.getElementById('intro-view');
    const shop  = document.getElementById('shop-view');
    shop.classList.add('acme-hidden');
    shop.style.opacity  = '0';
    intro.style.display = 'flex';
    intro.style.opacity = '1';
}

function showShopView(callback) {
    const intro = document.getElementById('intro-view');
    const shop  = document.getElementById('shop-view');
    intro.style.opacity = '0';
    intro.style.display = 'none';
    shop.classList.remove('acme-hidden');
    requestAnimationFrame(() => {
        shop.style.opacity = '1';
        if (typeof callback === 'function') callback();
    });
}

function showShopViewImmediate() {
    const intro = document.getElementById('intro-view');
    const shop  = document.getElementById('shop-view');
    intro.style.display   = 'none';
    intro.style.opacity   = '0';
    shop.style.transition = 'none';
    shop.classList.remove('acme-hidden');
    shop.style.opacity    = '1';
    requestAnimationFrame(() => { shop.style.transition = 'opacity 0.5s'; });
}

function enterShop() {
    history.pushState({}, '', '/shop/collections');
    showShopView(() => showCollections());
}

function exitToIntro() {
    history.pushState({}, '', '/shop');
    document.getElementById('shop-view').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('shop-view').classList.add('acme-hidden');
        const intro = document.getElementById('intro-view');
        intro.style.display = 'flex';
        intro.style.opacity = '1';
    }, 400);
}

function showCollections() {
    document.getElementById('pdp-view').classList.add('acme-hidden');
    document.getElementById('shop-home').classList.remove('acme-hidden');
    applyFilters();
}

function buildFilterLists() {
    const categoriesFromProducts = [...new Set(
        products.map(p => p.cat).filter(c => typeof c === 'string' && c.trim().length > 0)
    )].sort((a, b) => a.localeCompare(b));

    const cats  = ['All', ...categoriesFromProducts];
    const sorts = ['Relevance', 'Price: Low-High', 'Price: High-Low'];

    if (!cats.includes(curCat)) curCat = 'All';

    document.getElementById('cat-filters').innerHTML = cats.map(c =>
        `<li class="${c === curCat ? 'active' : ''}" onclick="handleFilter('cat','${escapeHTML(c)}',this)">${escapeHTML(c)}</li>`
    ).join('');

    document.getElementById('sort-filters').innerHTML = sorts.map(s =>
        `<li class="${s === curSort ? 'active' : ''}" onclick="handleFilter('sort','${escapeHTML(s)}',this)">${escapeHTML(s)}</li>`
    ).join('');
}

function handleFilter(type, val, el) {
    el.parentElement.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    el.classList.add('active');
    if (type === 'cat') curCat = val;
    else curSort = val;
    applyFilters();
}

function remainingBadgeHTML(remaining) {
    if (remaining <= 0) {
        return `<span class="remaining-badge remaining-badge-sold-out">Sold Out</span>`;
    }
    return `<span class="remaining-badge">${remaining} remaining</span>`;
}

function applyFilters() {
    let list = products.filter(p => curCat === 'All' || p.cat === curCat);
    if (curSort === 'Price: Low-High')  list.sort((a, b) => a.pVal - b.pVal);
    else if (curSort === 'Price: High-Low') list.sort((a, b) => b.pVal - a.pVal);

    document.getElementById('search-grid').innerHTML = list.map(p => {
        const safeName  = escapeHTML(p.name);
        const safePrice = escapeHTML(`$${p.pVal.toFixed(2)}`);
        const safeImg   = escapeHTML(p.imgs[0]);
        const safeSlug  = escapeHTML(p.id);
        const soldOut   = p.remaining <= 0;
        return `
            <div class="acme-card ${soldOut ? 'acme-card-sold-out' : ''}" onclick="openPDPBySlug('${safeSlug}', true)">
                <div class="acme-card-img-wrap">
                    <div class="acme-card-skeleton"></div>
                    <img src="${safeImg}" alt="${safeName}" loading="lazy" decoding="async" class="acme-card-img" onload="this.classList.add('acme-card-img-loaded'); this.previousElementSibling.classList.add('acme-card-skeleton-hidden');">
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:10px; align-items:center;">
                    <span style="font-size:0.75rem; font-weight:700; color:#fff;">${safeName}</span>
                    <span class="price-pill" style="margin:0; font-size:0.6rem; padding:3px 8px;">${safePrice}</span>
                </div>
                ${remainingBadgeHTML(p.remaining)}
            </div>`;
    }).join('');

    staggerIn('.acme-card');
}

// ─── PDP ──────────────────────────────────────────────────────────────────────
function openPDPBySlug(slug, pushStateOnOpen) {
    const product = products.find(p => p.id === slug);
    if (!product) {
        console.warn('Product not found for slug:', slug);
        showCollections();
        history.replaceState({}, '', '/shop/collections');
        return;
    }
    if (pushStateOnOpen) {
        history.pushState({}, '', `/shop/collections/${encodeURIComponent(slug)}`);
    }
    renderPDP(product);
}

// ─── Tier pricing helpers ─────────────────────────────────────────────────────
function getTierList(product) {
    return [
        { qty: 1, total: product.pVal, original: product.pVal },
        { qty: 2, total: product.tier2Total ?? product.pVal * 2, original: product.pVal * 2 },
        { qty: 3, total: product.tier3Total ?? product.pVal * 3, original: product.pVal * 3 },
    ];
}

function computeDefaultTierQty(product) {
    return product.remaining >= 2 ? 2 : 1;
}

function renderTierPricing(product, resetSelection) {
    const area = document.getElementById('tier-pricing-area');
    if (!area) return;

    const tiers = getTierList(product);

    if (resetSelection) {
        selectedTierQty = computeDefaultTierQty(product);
    }

    area.innerHTML = tiers.map((t) => {
        const savings = Math.max(0, t.original - t.total);
        const pct = t.original > 0 ? Math.round((savings / t.original) * 100) : 0;
        const disabled = product.remaining < t.qty;
        const isSelected = t.qty === selectedTierQty;

        const badge = t.qty === 2
            ? '<span class="tier-ribbon">MOST POPULAR</span>'
            : (t.qty === 3 ? '<span class="tier-ribbon tier-ribbon-best">BEST DEAL</span>' : '');

        return `
            <div class="tier-option ${isSelected ? 'tier-selected' : ''} ${disabled ? 'tier-disabled' : ''}"
                 data-qty="${t.qty}"
                 onclick="${disabled ? '' : `selectTier(${t.qty})`}">
                ${badge}
                <div class="tier-radio"></div>
                <div class="tier-info">
                    <div class="tier-title">Buy ${t.qty} ${savings > 0 ? `<span class="tier-save-badge">SAVE $${savings.toFixed(2)}</span>` : ''}</div>
                    <div class="tier-sub">${savings > 0 ? `You save ${pct}%` : (disabled ? 'Out of stock' : 'Standard price')}</div>
                </div>
                <div class="tier-price">
                    <div class="tier-price-now">$${t.total.toFixed(2)}</div>
                    ${savings > 0 ? `<div class="tier-price-was">$${t.original.toFixed(2)}</div>` : ''}
                </div>
            </div>`;
    }).join('');
}

function selectTier(qty) {
    selectedTierQty = qty;
    if (activeP) renderTierPricing(activeP, false);
}

function renderPDP(product) {
    activeP       = product;
    selectedSize  = activeP.sizes[0];
    selectedColor = activeP.colors[0];

    document.getElementById('pdp-img').src = activeP.imgs[0];
    document.getElementById('pdp-title').textContent = activeP.name;
    document.getElementById('pdp-price').textContent = `$${activeP.pVal.toFixed(2)} USD`;

    document.getElementById('pdp-thumbs').innerHTML = activeP.imgs.map((img, idx) => {
        const safeImg = escapeHTML(img);
        return `<img src="${safeImg}" class="thumb-img ${idx === 0 ? 'active' : ''}" onclick="setMainImg('${safeImg}', this)" alt="Product thumbnail" loading="lazy" decoding="async">`;
    }).join('');

    const displaySizes  = activeP.sizes.filter(s => s !== 'NA');
    const displayColors = activeP.colors.filter(c => c !== 'NA');

    document.getElementById('variant-area').innerHTML = `
        ${displaySizes.length ? `
        <div class="variant-container">
            <div class="variant-label">SIZE</div>
            <div class="variant-btns">
                ${displaySizes.map(s => {
                    const safe = escapeHTML(s);
                    return `<button class="acme-opt-btn ${s === selectedSize ? 'active' : ''}" onclick="setV('size','${safe}',this)">${safe}</button>`;
                }).join('')}
            </div>
        </div>` : ''}
        ${displayColors.length ? `
        <div class="variant-container">
            <div class="variant-label">COLOR</div>
            <div class="variant-btns">
                ${displayColors.map(c => {
                    const safe = escapeHTML(c);
                    return `<button class="acme-opt-btn ${c === selectedColor ? 'active' : ''}" onclick="setV('color','${safe}',this)">${safe}</button>`;
                }).join('')}
            </div>
        </div>` : ''}`;

    renderTierPricing(activeP, true);

    const soldEl = document.getElementById('pdp-sold-count');
    if (soldEl) {
        const count = soldCounts[activeP.id] || 0;
        if (count > 0) {
            soldEl.textContent = `${count.toLocaleString()} sold`;
            soldEl.style.display = 'block';
        } else {
            soldEl.style.display = 'none';
        }
    }

    const remainingEl = document.getElementById('pdp-remaining');
    const addBtn       = document.getElementById('pdp-add-btn');
    const isSoldOut    = activeP.remaining <= 0;

    if (remainingEl) {
        if (isSoldOut) {
            remainingEl.textContent = 'Product Sold Out';
            remainingEl.classList.add('pdp-sold-out');
        } else {
            remainingEl.textContent = `${activeP.remaining} remaining`;
            remainingEl.classList.remove('pdp-sold-out');
        }
        remainingEl.style.display = 'block';
    }

    if (addBtn) {
        addBtn.disabled = isSoldOut;
        addBtn.textContent = isSoldOut ? 'SOLD OUT' : 'ADD TO CART';
        addBtn.classList.toggle('add-btn-disabled', isSoldOut);
    }

    renderRelated();

    const home = document.getElementById('shop-home');
    const pdp  = document.getElementById('pdp-view');

    if (!home.classList.contains('acme-hidden')) {
        home.classList.add('pdp-exit');
        setTimeout(() => {
            home.classList.add('acme-hidden');
            home.classList.remove('pdp-exit');
            showPDP(pdp);
        }, 200);
    } else {
        home.classList.add('acme-hidden');
        showPDP(pdp);
    }
}

function showPDP(pdp) {
    pdp.classList.remove('acme-hidden');
    pdp.classList.remove('pdp-enter');
    void pdp.offsetWidth;
    pdp.classList.add('pdp-enter');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closePDP() {
    history.pushState({}, '', '/shop/collections');
    document.getElementById('pdp-view').classList.add('acme-hidden');
    document.getElementById('pdp-view').classList.remove('pdp-enter');
    document.getElementById('shop-home').classList.remove('acme-hidden');
    applyFilters();
}

function renderRelated() {
    const track = document.getElementById('related-marquee');
    const items = products.map(p => {
        const safeImg  = escapeHTML(p.imgs[0]);
        const safeName = escapeHTML(p.name);
        const safeSlug = escapeHTML(p.id);
        return `<div class="marquee-item" onclick="openPDPBySlug('${safeSlug}', true)"><img src="${safeImg}" alt="${safeName}" loading="lazy" decoding="async"></div>`;
    }).join('');
    track.innerHTML = items + items;
}

function setMainImg(url, el) {
    document.getElementById('pdp-img').src = url;
    document.querySelectorAll('.thumb-img').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
}

function setV(type, val, btn) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (type === 'size') {
        selectedSize = val;
    } else {
        selectedColor = val;
        if (activeP.colorMap && activeP.colorMap[val]) setMainImg(activeP.colorMap[val]);
    }
}

function staggerIn(sel) {
    const items = document.querySelectorAll(sel);
    items.forEach((item, i) => {
        item.classList.remove('fade-up-active');
        item.style.animationDelay = `${i * 0.1}s`;
        void item.offsetWidth;
        item.classList.add('fade-up-active');
    });
}

function setupSearch() {
    const searchBar = document.getElementById('acme-search-bar');
    const dropdown  = document.getElementById('search-dropdown');

    searchBar.addEventListener('input', (e) => {
        const rawVal  = e.target.value;
        const safeVal = rawVal.trim().toLowerCase();
        if (rawVal.length > 100) e.target.value = rawVal.slice(0, 100);

        if (safeVal.length < 1) {
            dropdown.classList.add('acme-hidden'); dropdown.innerHTML = ''; return;
        }

        const matches = products.filter(p => p.name.toLowerCase().includes(safeVal));
        if (matches.length === 0) {
            dropdown.classList.add('acme-hidden'); dropdown.innerHTML = ''; return;
        }

        dropdown.innerHTML = matches.map(p => {
            const safeName  = escapeHTML(p.name);
            const safePrice = escapeHTML(`$${p.pVal.toFixed(2)}`);
            const safeImg   = escapeHTML(p.imgs[0]);
            const safeSlug  = escapeHTML(p.id);
            return `
                <div class="search-item" onclick="openPDPBySlug('${safeSlug}', true); hideDropdown();">
                    <img src="${safeImg}" alt="${safeName}" loading="lazy" decoding="async">
                    <div>
                        <div style="font-weight:700; font-size:0.75rem;">${safeName}</div>
                        <div style="font-size:0.65rem;">${safePrice}</div>
                    </div>
                </div>`;
        }).join('');
        dropdown.classList.remove('acme-hidden');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) hideDropdown();
    });
}

function hideDropdown() {
    const dropdown = document.getElementById('search-dropdown');
    dropdown.classList.add('acme-hidden');
    dropdown.innerHTML = '';
}

function setupCartOutsideClick() {
    document.addEventListener('click', (e) => {
        const drawer = document.getElementById('cart-drawer');
        if (!drawer.classList.contains('open')) return;
        if (_cartJustOpened) { _cartJustOpened = false; return; }
        if (drawer.contains(e.target))       return;
        if (e.target.closest('.cart-label')) return;
        toggleCart(false);
    });
}

// ─── Cart ─────────────────────────────────────────────────────────────────────
function addToCart() {
    if (!activeP) return;
    if (activeP.remaining <= 0) return;
    if (activeP.remaining < selectedTierQty) {
        alert(`Only ${activeP.remaining} left in stock — please choose a smaller bundle.`);
        return;
    }

    const tiers = getTierList(activeP);
    const chosenTier = tiers.find(t => t.qty === selectedTierQty) || tiers[0];

    cart.push({
        ...activeP,
        selectedSize,
        selectedColor,
        selectedQty: chosenTier.qty,
        bundleTotal: chosenTier.total,
        cId: Date.now(),
    });
    updateCart();
    _cartJustOpened = true;
    toggleCart(true);
}

function removeFromCart(e, cId) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    cart = cart.filter(i => i.cId !== Number(cId));
    updateCart();
}

function updateCart() {
    document.getElementById('cart-count').textContent = cart.length;
    document.getElementById('cart-items').innerHTML = cart.map(i => {
        const safeName  = escapeHTML(i.name);
        const safeSize  = escapeHTML(i.selectedSize  !== 'NA' ? i.selectedSize  : '');
        const safeColor = escapeHTML(i.selectedColor !== 'NA' ? i.selectedColor : '');
        const safeImg   = escapeHTML(i.imgs[0]);
        const qtyLabel  = i.selectedQty > 1 ? `Qty ${i.selectedQty} (Bundle)` : '';
        const metaParts = [safeSize, safeColor, qtyLabel].filter(Boolean).join(' / ');
        return `
            <div class="cart-item-row">
                <div class="cart-item-thumb">
                    <img src="${safeImg}" alt="${safeName}" loading="lazy" decoding="async">
                    <button class="cart-remove-btn" onclick="removeFromCart(event, ${i.cId})" title="Remove item">✕</button>
                </div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${safeName}</div>
                    ${metaParts ? `<div class="cart-item-meta">${metaParts}</div>` : ''}
                </div>
                <div class="cart-item-price">$${i.bundleTotal.toFixed(2)}</div>
            </div>`;
    }).join('');
    const total = cart.reduce((s, i) => s + i.bundleTotal, 0);
    document.getElementById('cart-total').textContent = `$${total.toFixed(2)}`;
}

function toggleCart(open) {
    document.getElementById('cart-drawer').classList.toggle('open', open);
}

// ─── Stripe Checkout ──────────────────────────────────────────────────────────
async function startCheckout() {
    if (cart.length === 0) { alert('Your cart is empty!'); return; }

    const btn = document.getElementById('checkout-btn');
    btn.disabled    = true;
    btn.textContent = 'Redirecting...';

    const items = cart.map(item => ({
        slug:          item.id,
        selectedSize:  item.selectedSize,
        selectedColor: item.selectedColor,
        quantity:      item.selectedQty,
    }));

    try {
        const res  = await fetch('/create-checkout-session', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ items }),
        });
        const data = await res.json();

        if (data.url) {
            window.location.href = data.url;
        } else if (data.dev) {
            alert('🛠  Dev Mode — Stripe not configured yet.\n\nYour cart and products are working correctly.\nAdd your Stripe keys to .env to enable real payments.');
            btn.disabled    = false;
            btn.textContent = 'CHECKOUT';
        } else {
            alert('Checkout error: ' + escapeHTML(data.error || 'Unknown error'));
            btn.disabled    = false;
            btn.textContent = 'CHECKOUT';
        }
    } catch (err) {
        console.error('Checkout fetch error:', err);
        alert('Network error. Please try again.');
        btn.disabled    = false;
        btn.textContent = 'CHECKOUT';
    }
}

init();