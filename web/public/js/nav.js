// Shared chrome: glass nav dock (desktop), bottom tab bar (phones), footer, wallet button.
import { icon, LOGO, short, toast, esc } from './ui.js';
import { session } from './api.js';
import { signIn, signOut, hasWallet, walletError } from './wallet.js';

const LINKS = [
  { href: '/', label: 'Home', icon: 'home', key: 'home' },
  { href: '/marketplace', label: 'Market', icon: 'store', key: 'market' },
  { href: '/create', label: 'Create', icon: 'plus', key: 'create', make: true },
  { href: '/dashboard', label: 'My agents', icon: 'grid', key: 'dashboard' },
  { href: '/leaderboard', label: 'Ranks', icon: 'trophy', key: 'leaders' },
];

function walletButton() {
  const s = session.get();
  if (s) {
    return `<button class="btn btn-glass btn-sm wallet-btn" data-wallet aria-label="Wallet ${esc(s.wallet)}. Click to sign out"><span class="dot"></span><span class="mono">${short(s.wallet)}</span></button>`;
  }
  return `<button class="btn btn-primary btn-sm" data-wallet>${icon('wallet', 16)}<span>Connect</span></button>`;
}

export function mountNav(active) {
  const top = document.createElement('div');
  top.className = 'nav-dock';
  top.innerHTML = `<nav class="glass" aria-label="Main">
    <a href="/" class="brand">${LOGO}<span>TickerMind</span></a>
    <div class="nav-links">${LINKS.filter((l) => l.key !== 'home').map((l) => `<a href="${l.href}" ${l.key === active ? 'aria-current="page"' : ''}>${l.label}</a>`).join('')}</div>
    <div class="row gap-8" data-wallet-slot>${walletButton()}</div></nav>`;
  document.body.prepend(top);

  const bar = document.createElement('nav');
  bar.className = 'tabbar glass';
  bar.setAttribute('aria-label', 'Tabs');
  bar.innerHTML = LINKS.map((l) => `<a href="${l.href}" class="${l.make ? 'make' : ''}" ${l.key === active ? 'aria-current="page"' : ''}><span class="ic">${icon(l.icon, 20)}</span>${l.label}</a>`).join('');
  document.body.append(bar);

  const foot = document.createElement('footer');
  foot.className = 'foot';
  foot.innerHTML = `<div class="wrap wrap-row between gap-12"><span>TICKERMIND · BUILT ON BASE · TESTNET USDC</span><span>AI RESEARCH · NOT FINANCIAL ADVICE · PORTFOLIOS ARE SIMULATED</span></div>`;
  document.body.append(foot);

  const slot = top.querySelector('[data-wallet-slot]');
  const render = () => { slot.innerHTML = walletButton(); };
  window.addEventListener('tm:session', render);
  slot.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-wallet]')) return;
    if (session.get()) {
      if (confirm('Sign out of TickerMind?')) { signOut(); toast('Signed out.'); }
      return;
    }
    if (!hasWallet()) return toast('No wallet found. Install Coinbase Wallet or MetaMask.', 'error', 6000);
    try {
      const out = await signIn();
      toast('Signed in.', 'ok');
      if (active === 'home') location.href = out.agentCount ? '/dashboard' : '/create';
      else window.dispatchEvent(new Event('tm:signedin'));
    } catch (err) {
      toast(walletError(err), 'error');
    }
  });
}
