import { useEffect, useRef, useState } from 'react';
import { GameEngine, type Hud, type Phase } from './engine.ts';
import { t, type Lang } from './i18n.ts';
import type { Mode, Difficulty } from './rules.ts';
import type { Quality } from './gfx.ts';
import './styles.css';

const MODES: { id: Mode; icon: string }[] = [
  { id: 'free', icon: '⚔' },
  { id: 'storm', icon: '⛈' },
  { id: 'treasure', icon: '✦' }
];

function Minimap({ hud }: { hud: Hud }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    const scale = (W / 2 - 8) / 155;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(5,37,49,.75)';
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(229,181,102,.65)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 3, 0, Math.PI * 2); ctx.stroke();
    if (hud.mode === 'storm') {
      ctx.strokeStyle = 'rgba(120,190,220,.55)';
      ctx.beginPath(); ctx.arc(cx, cy, hud.safeR * scale, 0, Math.PI * 2); ctx.stroke();
    }
    for (const s of hud.leaderboard) {
      if (s.isMe) continue;
      ctx.fillStyle = s.alive ? '#e76b62' : 'rgba(180,180,180,.4)';
      ctx.beginPath(); ctx.arc(cx + s.x * scale, cy + s.z * scale, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const px = cx + hud.x * scale, py = cy + hud.z * scale;
    ctx.fillStyle = 'rgba(245,190,105,.95)';
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI - hud.heading);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = 'rgba(160,220,210,.45)';
    ctx.font = '10px system-ui'; ctx.fillText('N', cx - 3, 12);
  }, [hud]);
  return <canvas className="minimap" ref={ref} width={180} height={180} />;
}

function SkillButton({ label, keyHint, cd, max, onDown, onUp, className = '' }: {
  label: string; keyHint: string; cd: number; max: number;
  onDown: () => void; onUp?: () => void; className?: string;
}) {
  const pct = Math.max(0, Math.min(1, cd / max));
  return (
    <button
      className={`skill ${className} ${cd > 0 ? 'cooling' : ''}`}
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onDown(); }}
      onPointerUp={e => { e.preventDefault(); e.stopPropagation(); onUp?.(); }}
      onPointerCancel={() => onUp?.()}
      onPointerLeave={() => onUp?.()}
    >
      <span className="skill-cd" style={{ height: `${pct * 100}%` }} />
      <span className="skill-label">{label}</span>
      <span className="skill-key">{keyHint}</span>
    </button>
  );
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<Hud>({
    phase: 'menu', hp: 100, score: 0, time: 180, leaderboard: [], reloadL: 0, reloadR: 0,
    dashCd: 0, repairCd: 0, supplyCd: 0, ammoL: 12, ammoR: 12, alive: true, respawnIn: 0,
    mode: 'free', online: false, roomCode: '', connection: false, menuOpen: false,
    stormR: 155, safeR: 130, x: 0, z: 0, heading: 0, notice: ''
  });
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('lsy-lang') as Lang) || 'zh');
  const [mode, setMode] = useState<Mode>('free');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [quality, setQuality] = useState<Quality>(() => (localStorage.getItem('lsy-quality') as Quality) || 'medium');
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('lsy-volume') ?? .6));
  const [muted, setMuted] = useState(() => localStorage.getItem('lsy-muted') === '1');
  const [nickname, setNickname] = useState(() => localStorage.getItem('lsy-name') || '破风者');
  const [roomInput, setRoomInput] = useState('');
  const [modal, setModal] = useState<'none' | 'settings' | 'guide' | 'menu'>('none');
  const tr = (k: string) => t(lang, k);

  useEffect(() => {
    if (!mountRef.current) return;
    const e = new GameEngine(mountRef.current, quality, setHud);
    e.onToggleMenu = () => {
      setModal(m => {
        const next = m === 'menu' ? 'none' : 'menu';
        e.setMenuOpen(next === 'menu');
        return next;
      });
    };
    engineRef.current = e;
    (window as any).__lsyEngine = e;
    return () => { e.dispose(); engineRef.current = null; };
  }, []);

  useEffect(() => { localStorage.setItem('lsy-lang', lang); }, [lang]);
  useEffect(() => { localStorage.setItem('lsy-quality', quality); engineRef.current?.applyQuality(quality); }, [quality]);
  useEffect(() => { localStorage.setItem('lsy-volume', String(volume)); engineRef.current?.setVolume(volume); }, [volume]);
  useEffect(() => { localStorage.setItem('lsy-muted', muted ? '1' : '0'); engineRef.current?.setMuted(muted); }, [muted]);
  useEffect(() => { localStorage.setItem('lsy-name', nickname); }, [nickname]);

  const startSolo = () => {
    localStorage.setItem('lsy-name', nickname);
    engineRef.current?.startSolo(mode, difficulty, nickname || tr('captain'));
    setModal('none');
  };
  const startOnline = (action: 'quick' | 'create' | 'join') => {
    localStorage.setItem('lsy-name', nickname);
    if (action === 'join' && roomInput.trim().length < 4) {
      setHud(h => ({ ...h, notice: tr('badCode') }));
      return;
    }
    engineRef.current?.connectOnline(mode, difficulty, nickname || tr('captain'), action, roomInput.trim().toUpperCase());
    setModal('none');
  };
  const toggleMenu = () => {
    const next = modal === 'menu' ? 'none' : 'menu';
    setModal(next);
    engineRef.current?.setMenuOpen(next === 'menu');
  };
  const closeModal = () => { setModal('none'); engineRef.current?.setMenuOpen(false); };
  const phase = hud.phase;
  const myRank = hud.leaderboard.findIndex(s => s.isMe) + 1;
  const win = hud.winnerId && hud.leaderboard[0]?.isMe;

  return (
    <div className={`app ${phase === 'playing' ? 'in-game' : ''}`}>
      <div className="scene" ref={mountRef} />
      <div className="vignette" />

      {phase === 'menu' && (
        <div className="home screen">
          <header className="topbar">
            <div className="brand">
              <span className="brand-mark">LSY</span>
              <span className="brand-text"><b>{tr('title')}</b><small>lsy Stormbreakers</small></span>
            </div>
            <div className="top-actions">
              <button className="ghost" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>{lang === 'zh' ? 'EN' : '中文'}</button>
              <button className="ghost" onClick={() => setModal('guide')}>{tr('guide')}</button>
              <button className="ghost" onClick={() => setModal('settings')}>⚙ {tr('settings')}</button>
            </div>
          </header>

          <div className="home-content">
            <div className="hero">
              <div className="eyebrow">{tr('subtitle')}</div>
              <h1><span>LSY ·</span> {tr('title')}<em>lsy Stormbreakers</em></h1>
              <p className="hero-line" />
            </div>
            <div className="home-panel">
              <label className="field-label">{tr('nickname')}</label>
              <input className="input name-input" value={nickname} maxLength={14} placeholder={tr('nicknameHint')} onChange={e => setNickname(e.target.value)} />
              <label className="field-label">{tr('mode')}</label>
              <div className="mode-grid">
                {MODES.map(m => (
                  <button key={m.id} className={`mode-card ${mode === m.id ? 'active' : ''}`} onClick={() => setMode(m.id)}>
                    <span className="mode-icon">{m.icon}</span>
                    <b>{tr(m.id)}</b>
                    <small>{tr(m.id + 'Desc')}</small>
                  </button>
                ))}
              </div>
              <button className="primary big" onClick={startSolo}>⛵ {tr('start')}</button>
              <div className="online-row">
                <button className="secondary" onClick={() => startOnline('quick')}>{tr('quick')}</button>
                <button className="secondary" onClick={() => startOnline('create')}>{tr('create')}</button>
              </div>
              <div className="join-row">
                <input className="input" value={roomInput} maxLength={5} placeholder={tr('roomCodeHint')} onChange={e => setRoomInput(e.target.value.toUpperCase())} />
                <button className="secondary" onClick={() => startOnline('join')}>{tr('join')}</button>
              </div>
              {hud.notice && <div className="notice">{hud.notice}</div>}
              <div className="bot-note">· {tr('bots')}</div>
            </div>
          </div>
        </div>
      )}

      {phase === 'connecting' && (
        <div className="screen overlay-center">
          <div className="glass card connecting"><div className="spinner" />{tr('connecting')}</div>
        </div>
      )}

      {(phase === 'playing' || phase === 'ended' || modal === 'menu') && (
        <div className="hud">
          <div className="hud-top">
            <div className="glass status-block">
              <div className="status-title"><span>{tr('hp')}</span><b>{Math.round(hud.hp)} / 100</b></div>
              <div className="hpbar"><i style={{ width: `${hud.hp}%`, background: hud.hp > 50 ? 'linear-gradient(90deg,#e8b96a,#f4d9a0)' : 'linear-gradient(90deg,#c8524e,#ed8a72)' }} /></div>
              <div className="status-sub">{hud.alive ? `${tr('score')} ${hud.score}` : `${tr('respawn')} ${hud.respawnIn.toFixed(1)}s`}</div>
            </div>
            <div className="glass timer-block">
              <small>{tr('time')}</small>
              <b>{String(Math.floor(hud.time / 60)).padStart(2, '0')}:{String(Math.floor(hud.time % 60)).padStart(2, '0')}</b>
              <small>{tr(hud.mode)} {hud.online ? `· ${hud.roomCode}` : ''}</small>
            </div>
            <div className="glass rank-block">
              <div className="status-title"><span>{tr('leaderboard')}</span><button className="icon-btn" onClick={toggleMenu}>{tr('pause')} ❚❚</button></div>
              <div className="rank-list">
                {hud.leaderboard.slice(0, 6).map((s, i) => (
                  <div key={s.id} className={`rank-row ${s.isMe ? 'me' : ''}`}>
                    <span>{i + 1}</span><b style={{ color: `#${s.color.toString(16).padStart(6, '0')}` }}>{s.name}</b>
                    <em>{s.score}</em><small>{s.alive ? '' : '☠'}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {hud.mode === 'storm' && hud.safeR < 125 && hud.alive && (
            <div className="storm-banner">⚠ {tr('stormWarning')}</div>
          )}

          <div className="hud-bottom">
            <div className="cannon-group">
              <SkillButton className="fire-l" label={tr('fireL')} keyHint="Q" cd={hud.reloadL} max={3}
                onDown={() => engineRef.current?.setMobileFire('L', true)} onUp={() => engineRef.current?.setMobileFire('L', false)} />
              <div className="ammo">{hud.ammoL} / {hud.ammoR} <small>AMMO</small></div>
              <SkillButton className="fire-r" label={tr('fireR')} keyHint="E" cd={hud.reloadR} max={3}
                onDown={() => engineRef.current?.setMobileFire('R', true)} onUp={() => engineRef.current?.setMobileFire('R', false)} />
            </div>
            <div className="skill-group">
              <SkillButton label={tr('dash')} keyHint="SPACE" cd={hud.dashCd} max={10} onDown={() => engineRef.current?.triggerSkill('dash')} />
              <SkillButton label={tr('repair')} keyHint="R" cd={hud.repairCd} max={12} onDown={() => engineRef.current?.triggerSkill('repair')} />
              <SkillButton label={tr('supply')} keyHint="F" cd={hud.supplyCd} max={14} onDown={() => engineRef.current?.triggerSkill('supply')} />
            </div>
            <Minimap hud={hud} />
          </div>
        </div>
      )}

      {modal === 'menu' && (
        <div className="screen overlay-center modal-back">
          <div className="glass card menu-card">
            <h2>{hud.online ? tr('onlineMenuHint') : tr('paused')}</h2>
            <p>{hud.online ? tr('onlineMenuHint') : tr('pausedHint')}</p>
            <button className="primary" onClick={closeModal}>{tr('resume')}</button>
            <div className="modal-row">
              <button className="secondary" onClick={() => setModal('settings')}>⚙ {tr('settings')}</button>
              <button className="secondary" onClick={() => setModal('guide')}>{tr('guide')}</button>
            </div>
            <button className="ghost wide" onClick={() => { engineRef.current?.enterMenu(); closeModal(); }}>{tr('backHome')}</button>
          </div>
        </div>
      )}

      {modal === 'settings' && (
        <div className="screen overlay-center modal-back">
          <div className="glass card settings-card">
            <h2>⚙ {tr('settings')}</h2>
            <div className="setting-row"><span>{tr('language')}</span>
              <div className="seg"><button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>中文</button><button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button></div>
            </div>
            <div className="setting-row"><span>{tr('difficulty')}</span>
              <div className="seg">{(['easy', 'normal', 'hard'] as Difficulty[]).map(d => <button key={d} className={difficulty === d ? 'on' : ''} onClick={() => setDifficulty(d)}>{tr(d)}</button>)}</div>
            </div>
            <div className="setting-row"><span>{tr('quality')}</span>
              <div className="seg">{(['low', 'medium', 'high'] as Quality[]).map(q => <button key={q} className={quality === q ? 'on' : ''} onClick={() => setQuality(q)}>{tr(q)}</button>)}</div>
            </div>
            <div className="setting-row"><span>{tr('volume')}</span>
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} />
              <b>{Math.round(volume * 100)}%</b>
            </div>
            <div className="setting-row"><span>{tr('mute')}</span>
              <button className={`toggle ${muted ? 'on' : ''}`} onClick={() => setMuted(!muted)}>{muted ? 'ON' : 'OFF'}</button>
            </div>
            <button className="primary" onClick={closeModal}>{tr('close')}</button>
          </div>
        </div>
      )}

      {modal === 'guide' && (
        <div className="screen overlay-center modal-back">
          <div className="glass card guide-card">
            <h2>📖 {tr('guideTitle')}</h2>
            <ol>{[1, 2, 3, 4, 5].map(i => <li key={i}>{tr('guide' + i)}</li>)}</ol>
            <button className="primary" onClick={closeModal}>{tr('close')}</button>
          </div>
        </div>
      )}

      {phase === 'ended' && modal === 'none' && (
        <div className="screen overlay-center">
          <div className="glass card result-card">
            <h2>{win ? `🏆 ${tr('victory')}` : tr('defeat')}</h2>
            <div className="result-sub">{tr('result')} · {tr(mode)}</div>
            <table className="result-table">
              <thead><tr><th>{tr('rank')}</th><th>{tr('captain')}</th><th>{tr('score')}</th><th>{tr('kills')}</th></tr></thead>
              <tbody>{hud.leaderboard.map((s, i) => (
                <tr key={s.id} className={s.isMe ? 'me' : ''}><td>{i + 1}</td><td>{s.name}</td><td>{s.score}</td><td>{s.kills}</td></tr>
              ))}</tbody>
            </table>
            <div className="modal-row">
              <button className="primary" onClick={() => engineRef.current?.restart()}>{tr('restart')}</button>
              <button className="secondary" onClick={() => { engineRef.current?.enterMenu(); }}>{tr('backHome')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
