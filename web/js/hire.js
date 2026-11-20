// "Hire" flow: pay with wallet (real testnet USDC, or simulated) or hire as one of your own agents (A2A).
import { api, state, isSignedIn, connect, payOrderOnchain, friendlyErr } from './api.js';
import { html, mount, ic, avatar, usd, openModal, toast, poll, $, delegate, raw, busy } from './ui.js';
import { catHint, catLabel } from './components.js';

export function hireModal(svc, agent) {
  const a = agent || svc.agent;
  const fixed = svc.category === 'market_intelligence';
  const cfg = state.config;
  let method = 'wallet';

  openModal(html`<div id="hire"></div>`, (sheet, close) => {
    const root = $('#hire', sheet);
    const view = async () => {
      if (!isSignedIn()) {
        return mount(root, html`<div class="stack"><div class="row">${avatar(a.avatar, 52)}<div><h3>${svc.title}</h3><span class="sm mute">${a.name}</span></div></div>
          <p class="mute">Connect your wallet to hire this agent.</p><button class="btn primary" id="c">${ic('wallet')} Connect wallet</button></div>`),
          $('#c', root).addEventListener('click', async (e) => { try { await busy(e.currentTarget, connect); view(); } catch (err) { toast(friendlyErr(err), 'err'); } });
      }
      let mine = [];
      try { mine = (await api('/me')).agents.filter((x) => x.status === 'active' && x.config.permissions.requestServices && x.id !== svc.agentId); } catch {}
      mount(root, html`<div class="stack">
        <div class="row" style="gap:14px">${avatar(a.avatar, 56)}<div style="flex:1;min-width:0"><h3>${svc.title}</h3><span class="sm mute">${a.name} · about ${svc.estMinutes} min</span></div><div class="mono" style="font-size:1.4rem;font-weight:500">${usd(svc.price)}<span class="sm mute"> USDC</span></div></div>
        ${fixed ? '' : html`<label class="f">What should it research?<input id="target" maxlength="60" placeholder="${catHint[svc.category]}" autocomplete="off"></label>`}
        <div class="row"><button class="chip pick" data-m="wallet" aria-pressed="${method === 'wallet'}">${ic('wallet')} Pay with wallet</button>
          <button class="chip pick" data-m="agent" aria-pressed="${method === 'agent'}">${ic('bot')} Hire as my agent</button></div>
        <div id="pay"></div></div>`);
      const target = () => (fixed ? 'US market' : $('#target', root).value.trim());
      const pay = $('#pay', root);
      const paint = () => {
        $$m('[data-m]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === method)));
        if (method === 'wallet') {
          mount(pay, html`<div class="stack">
            ${cfg.chainEnabled && a.onchainAgentId !== null && a.onchainAgentId !== undefined ? html`<button class="btn primary" id="onchain">${ic('coin')} Pay ${usd(svc.price)} testnet USDC</button>` : ''}
            ${cfg.demoMode ? html`<button class="btn ${cfg.chainEnabled && a.onchainAgentId != null ? '' : 'primary'}" id="sim">${ic('bolt')} Simulated payment</button><span class="xs mute">No wallet funds used. Great for trying it out.</span>` : ''}
            ${!cfg.chainEnabled && !cfg.demoMode ? html`<p class="err">Payments are not set up on this server.</p>` : ''}
            <div id="status"></div></div>`);
        } else if (!mine.length) {
          mount(pay, html`<div class="empty tile"><p class="sm">You need an active agent that can hire others.</p><a class="btn sm" href="#/create" data-close>Create agent</a></div>`);
        } else {
          mount(pay, html`<div class="stack"><label class="f">Pay from<select id="from">${mine.map((m) => html`<option value="${m.id}">${m.name} · ${usd(m.balances.operating)} USDC</option>`)}</select></label>
            <button class="btn primary" id="a2a">${ic('send')} Send request</button><span class="xs mute">You approve the payment before any money moves.</span><div id="status"></div></div>`);
        }
      };
      paint();
      delegate(root, 'click', '[data-m]', (_e, b) => { method = b.dataset.m; paint(); });

      const track = async (orderId) => {
        const st = $('#status', root);
        mount(st, html`<div class="row"><span class="spin"></span> Researching…</div>`);
        const o = await poll(() => api('/orders/' + orderId), (x) => ['completed', 'refunded'].includes(x.status), { every: 2000 });
        if (o.status === 'completed') mount(st, html`<div class="row between"><span class="chip green">${ic('check')} Delivered</span><a class="btn primary sm" href="#/report/${o.reportId}" data-close>Open report</a></div>`);
        else mount(st, html`<p class="err">The research failed. ${o.kind === 'human' ? 'Ask the agent owner for a refund.' : 'Your simulated payment was returned.'}</p>`);
      };
      const guard = () => { const t = target(); if (!fixed && !t) { toast('Enter what to research', 'err'); return null; } return t; };

      pay.addEventListener('click', async (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        const st = $('#status', root);
        try {
          if (btn.id === 'onchain' || btn.id === 'sim') {
            const t = guard(); if (!t) return;
            await busy(btn, async () => {
              const r = await api('/orders', { method: 'POST', body: { serviceId: svc.id, target: t } });
              if (btn.id === 'sim') await api(`/orders/${r.order.id}/demo-pay`, { method: 'POST' });
              else {
                const hash = await payOrderOnchain(r.payment, (s) => mount(st, html`<div class="row"><span class="spin"></span> ${s === 'approve' ? 'Approve USDC in your wallet…' : 'Confirm payment in your wallet…'}</div>`));
                mount(st, html`<div class="row"><span class="spin"></span> Verifying on Base…</div>`);
                await api(`/orders/${r.order.id}/confirm`, { method: 'POST', body: { txHash: hash } });
              }
              await track(r.order.id);
            });
          } else if (btn.id === 'a2a') {
            const t = guard(); if (!t) return;
            await busy(btn, async () => {
              const req = await api('/a2a', { method: 'POST', body: { fromAgentId: $('#from', root).value, serviceId: svc.id, target: t } });
              mount(pay, html`<div class="stack"><div class="tile"><b>${req.from.name}</b> wants to hire <b>${req.to.name}</b><br><span class="mono">${usd(req.amount)} USDC</span> <span class="chip amber">Simulated</span></div>
                <div class="row"><button class="btn primary" id="ok">${ic('check')} Approve payment</button><button class="btn" id="no">Cancel</button></div><div id="status"></div></div>`);
              $('#no', root).onclick = async () => { await api(`/a2a/${req.id}/reject`, { method: 'POST' }).catch(() => {}); close(); };
              $('#ok', root).onclick = async (ev) => {
                try {
                  await busy(ev.currentTarget, async () => {
                    await api(`/a2a/${req.id}/approve`, { method: 'POST' });
                    const s2 = $('#status', root); mount(s2, html`<div class="row"><span class="spin"></span> Funds held. Researching…</div>`);
                    const d = await poll(() => api('/a2a?agentId=' + req.from.id).then((l) => l.find((x) => x.id === req.id)), (x) => x && ['completed', 'failed'].includes(x.status), { every: 2000 });
                    document.dispatchEvent(new CustomEvent('tm:refresh-tape'));
                    if (d.status === 'completed') mount(s2, html`<div class="row between"><span class="chip green">${ic('check')} Delivered</span><a class="btn primary sm" href="#/report/${d.reportId}" data-close>Open report</a></div>`);
                    else mount(s2, html`<p class="err">The research failed. Your funds were returned.</p>`);
                  });
                } catch (err) { toast(friendlyErr(err), 'err'); }
              };
            });
          }
        } catch (err) { mount($('#status', root) || pay, html`<p class="err">${friendlyErr(err)}</p>`); }
      });
    };
    view();
  });
}
const $$m = (s, r) => [...r.querySelectorAll(s)];
