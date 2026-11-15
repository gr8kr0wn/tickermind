import { mountNav } from '../nav.js';
import { api } from '../api.js';
import { $, qs, esc, safeUrl, icon, identicon, toast, SECTOR_ON, pad, ago } from '../ui.js';
import { explorerTx, signIn, walletError } from '../wallet.js';

mountNav('');

const id = qs('id');

/** Turns [f3] / [n2] citations from the AI into small chips. Input is escaped first. */
const cite = (text) => esc(text).replace(/\[(f|n)(\d+)\]/g, (_m, k, n) => `<a href="#${k}${n}" class="cite">${k}${n}</a>`);

async function load() {
  const root = $('#report');
  let d;
  try {
    d = await api.get(`reports?id=${encodeURIComponent(id || '')}`);
  } catch (e) {
    root.innerHTML = `<div class="empty">${icon('lock', 30)}<span>${esc(e.message)}</span>
      ${e.status === 403 ? '<button class="btn btn-glass" id="si">Sign in</button>' : ''}<a href="/marketplace" class="btn btn-primary">Marketplace</a></div>`;
    $('#si')?.addEventListener('click', async () => { try { await signIn(); load(); } catch (err) { toast(walletError(err), 'error'); } });
    return;
  }
  const c = d.report.content;
  const an = c.analysis;
  const v = d.verification;
  document.title = `${c.company.name} (${c.ticker}) — TickerMind`;
  const txUrl = d.order?.fulfillTx ? await explorerTx(d.order.fulfillTx) : null;

  root.innerHTML = `<div class="stack gap-24">
    <div class="row between wrap-row gap-16">
      <a href="/agent?id=${esc(d.agent.id)}" class="row gap-12" style="color:var(--paper)" data-sector="${esc(d.agent.sector)}">
        ${identicon(d.agent.name, SECTOR_ON[d.agent.sector], 44)}<span class="stack"><b>${esc(d.agent.name)}</b><span class="mono muted" style="font-size:12px">AGENT ${pad(d.agent.onchainId)}</span></span></a>
      <div class="row gap-8 wrap-row">
        ${d.report.origin === 'order' ? '<span class="tag tag-good">Purchased</span>' : d.report.published ? '<span class="tag tag-blue">Public</span>' : '<span class="tag tag-amber">Draft · only you can see this</span>'}
        ${d.isOwner && d.report.origin === 'owner' ? `<button class="btn btn-${d.report.published ? 'glass' : 'primary'} btn-sm" id="pub">${d.report.published ? 'Unpublish' : `${icon('check', 14)} Approve &amp; publish`}</button>` : ''}
        <button class="btn btn-glass btn-sm" id="copy">${icon('link', 14)} Copy link</button>
      </div>
    </div>

    <article class="paper">
      <header class="stack gap-16">
        <span class="mono" style="font-size:12px;color:#5E5B55">REPORT · ${esc(c.ticker)} · ${esc(new Date(c.generatedAt).toLocaleString())}</span>
        <h1 style="font-size:clamp(32px,5vw,52px);color:#17181A">${esc(c.company.name)}</h1>
        <div class="wrap-row gap-8" style="font-size:14px;color:#5E5B55">
          ${[c.company.exchange, c.company.industry, c.company.country].filter(Boolean).map((x) => `<span class="mono" style="background:#DAD7CF;padding:4px 8px;border-radius:6px;font-size:12px">${esc(x)}</span>`).join('')}
        </div>
        <div class="stack gap-8">
          <div class="row between" style="font-size:15px;font-weight:700"><span style="color:#0040C8">Bull ${an.bull_score}</span><span style="color:#8A5300">${100 - an.bull_score} Bear</span></div>
          <div class="row" style="height:14px;border-radius:7px;overflow:hidden;position:relative"><span style="flex-grow:${an.bull_score};background:var(--blue);height:100%"></span><span style="flex-grow:${100 - an.bull_score};background:#D9A441;height:100%"></span><span style="position:absolute;left:${an.bull_score}%;top:-3px;width:4px;height:20px;margin-left:-2px;background:#17181A;border-radius:2px"></span></div>
        </div>
      </header>

      <section class="stack gap-12"><h2>Overview</h2><div class="ai"><span>${cite(an.overview)}</span><span class="aitag">AI INTERPRETATION</span></div></section>

      <section class="stack gap-12"><h2>Verified facts</h2>
        ${c.facts.map((f) => `<div class="fact" id="${esc(f.id)}"><span style="font-size:15px">${esc(f.label)}${f.detail ? `<br><span style="color:#5E5B55;font-size:13px">${esc(f.detail)}</span>` : ''}</span><b>${esc(f.value)}</b>
          <span class="src"><span class="mono" style="font-size:11px;color:#8E8A80">${esc(f.id)}</span>${f.source?.url ? `<a class="srcchip" href="${esc(safeUrl(f.source.url))}" target="_blank" rel="noopener">${icon('file', 11)}${esc(f.source.name)} · ${esc(f.source.ref || '')}${f.source.filed ? ` · filed ${esc(f.source.filed)}` : ''}</a>` : ''}</span></div>`).join('')}
      </section>

      <section class="stack gap-12"><h2>Revenue &amp; earnings</h2><div class="ai"><span>${cite(an.revenue_analysis)}</span><span class="aitag">AI INTERPRETATION</span></div></section>
      <section class="stack gap-12"><h2>Industry</h2><div class="ai"><span>${cite(an.industry)}</span><span class="aitag">AI INTERPRETATION</span></div></section>

      <section class="bb">
        <div class="stack gap-12" style="background:#fff;border-radius:16px;padding:18px;border-top:4px solid var(--blue)"><h2 style="color:#0040C8">Bull case</h2><ul>${an.bull.map((x) => `<li>${cite(x)}</li>`).join('')}</ul></div>
        <div class="stack gap-12" style="background:#fff;border-radius:16px;padding:18px;border-top:4px solid #D9A441"><h2 style="color:#8A5300">Bear case</h2><ul>${an.bear.map((x) => `<li>${cite(x)}</li>`).join('')}</ul></div>
      </section>

      <section class="stack gap-12"><h2>Risks</h2><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px">${an.risks.map((x) => `<li>${cite(x)}</li>`).join('')}</ul></section>

      <section class="stack gap-12"><h2>Conclusion</h2><div class="ai" style="font-size:19px"><span>${cite(an.conclusion)}</span><span class="aitag">AI CONCLUSION · NOT FINANCIAL ADVICE</span></div></section>

      ${c.news.length ? `<section class="stack gap-12"><h2>News used</h2>${c.news.map((n, i) => `<a id="n${i + 1}" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener" class="row gap-12" style="color:#17181A;padding:10px 0;border-bottom:1px solid #DAD7CF"><span class="mono" style="font-size:11px;color:#8E8A80">n${i + 1}</span><span style="flex:1">${esc(n.headline)}</span><span class="mono" style="font-size:12px;color:#5E5B55;white-space:nowrap">${esc(n.source)} · ${esc(n.date)}</span></a>`).join('')}</section>` : ''}

      <footer style="font-size:13px;color:#5E5B55">${esc(c.disclaimer)}</footer>
    </article>

    <div class="verify glass">
      <div class="row gap-8"><span class="blue">${icon('shield', 18)}</span><b>Verification</b></div>
      <div class="vrow">${v.contentIntact ? `<span class="tag tag-good">${icon('check', 11)}Content intact</span>` : `<span class="tag tag-bad">${icon('x', 11)}Content changed</span>`}<span class="muted">Hash recomputed from this report matches the stored hash.</span></div>
      ${v.onchainHash ? `<div class="vrow">${v.onchainMatch ? `<span class="tag tag-good">${icon('check', 11)}Matches Base</span>` : `<span class="tag tag-bad">${icon('x', 11)}Mismatch</span>`}<span class="muted">Hash recorded in AgentMarketplace when payment was released.</span></div>` : '<div class="vrow"><span class="tag">Not sold</span><span class="muted">Owner reports are hashed; sold reports also get the hash written onchain.</span></div>'}
      <div class="mono dim" style="font-size:12px;word-break:break-all">${esc(v.storedHash)}</div>
      ${txUrl ? `<a href="${esc(txUrl)}" target="_blank" rel="noopener" class="row gap-8 mono" style="font-size:13px">View payment release on BaseScan ${icon('ext', 12)}</a>` : ''}
      <span class="muted" style="font-size:12px">Engine: ${esc(d.report.model || 'n/a')} · ${ago(d.report.createdAt)}</span>
    </div>

    ${d.canRate ? `<div class="panel row between wrap-row gap-12"><b>Rate this report</b><div class="rate row" id="rate">${[1, 2, 3, 4, 5].map((n) => `<button data-r="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star', 26)}</button>`).join('')}</div></div>` : ''}
  </div>`;

  $('#copy').onclick = () => { navigator.clipboard?.writeText(location.href); toast('Link copied.', 'ok'); };
  $('#pub')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await api.post('research', { action: d.report.published ? 'unpublish' : 'publish', reportId: d.report.id }); toast(d.report.published ? 'Unpublished.' : 'Published.', 'ok'); load(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#rate')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    try { await api.post('orders', { action: 'rate', id: d.order.id, rating: Number(b.dataset.r) }); toast('Thanks for rating.', 'ok'); load(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#rate')?.addEventListener('mouseover', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    [...$('#rate').children].forEach((x) => x.classList.toggle('on', Number(x.dataset.r) <= Number(b.dataset.r)));
  });
}

window.addEventListener('tm:session', load);
load();
