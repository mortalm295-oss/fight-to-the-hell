import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Pause, RotateCcw, Send } from 'lucide-react';
import type { MinimapDrawData } from '../game/battleScene';
import {
  MAP_HALF,
  MAP_SIZE,
  MAX_COMMANDER_MEDALS,
  MEDALS,
  ROUT_MORALE_THRESHOLD,
  UNIT_CLASSES,
} from '../game/constants';
import { getSquadMedalBonuses } from '../game/rules';
import type { BattleSnapshot } from '../game/types';
import { MedalIcon, UnitClassIcon } from './TacticalIcons';

interface BattleHudProps {
  snapshot: BattleSnapshot;
  muted: boolean;
  getMinimapData: () => MinimapDrawData;
  onSelectSquad: (id: string) => void;
  onPanToWorld: (x: number, z: number) => void;
  onSubmitCommand: (cmd: string) => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
}

const QUICK_ORDERS = [
  'Advance',
  'Raise shields',
  'Line formation',
  'Spread out',
  'Split',
  'Hold',
];

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const BattleHud: React.FC<BattleHudProps> = ({
  snapshot,
  muted,
  getMinimapData,
  onSelectSquad,
  onPanToWorld,
  onSubmitCommand,
  onToggleMute,
  onPause,
  onRestart,
}) => {
  const [commandText, setCommandText] = useState('');
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus command bar on Enter when not typing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (snapshot.phase !== 'playing') return;
      const active = document.activeElement;
      if (e.key === 'Enter' && active !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key >= '1' && e.key <= '9' && active !== inputRef.current) {
        const idx = Number.parseInt(e.key, 10) - 1;
        const aliveAllies = snapshot.alliedSquads.filter((s) => !s.eliminated);
        if (aliveAllies[idx]) {
          onSelectSquad(aliveAllies[idx].id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [snapshot.phase, snapshot.alliedSquads, onSelectSquad]);

  // Draw live tactical minimap
  useEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = getMinimapData();
    const w = canvas.width;
    const h = canvas.height;
    const cellW = w / data.gridRes;
    const cellH = h / data.gridRes;

    ctx.fillStyle = '#18241d';
    ctx.fillRect(0, 0, w, h);

    // Subtle river band across minimap
    ctx.strokeStyle = '#295f7a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let px = 0; px <= w; px += 6) {
      const wx = (px / w) * MAP_SIZE - MAP_HALF;
      const wz = Math.sin(wx * 0.065) * 9.5 - wx * 0.14;
      const py = ((wz + MAP_HALF) / MAP_SIZE) * h;
      if (px === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Fog overlay cells
    for (let gz = 0; gz < data.gridRes; gz++) {
      for (let gx = 0; gx < data.gridRes; gx++) {
        const val = data.fogGrid[gz * data.gridRes + gx];
        if (val === 0) {
          ctx.fillStyle = 'rgba(7, 10, 16, 0.92)';
          ctx.fillRect(gx * cellW, gz * cellH, cellW + 0.5, cellH + 0.5);
        } else if (val === 1) {
          ctx.fillStyle = 'rgba(10, 15, 24, 0.48)';
          ctx.fillRect(gx * cellW, gz * cellH, cellW + 0.5, cellH + 0.5);
        }
      }
    }

    // Squad dots
    for (const sq of data.squads) {
      const mx = ((sq.x + MAP_HALF) / MAP_SIZE) * w;
      const mz = ((sq.z + MAP_HALF) / MAP_SIZE) * h;
      ctx.fillStyle =
        sq.faction === 'allied'
          ? sq.selected
            ? '#f2d588'
            : '#5ca4e6'
          : '#e0534e';
      ctx.beginPath();
      ctx.arc(mx, mz, sq.selected ? 4 : 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (sq.routing) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Camera viewport box
    const camMx = ((data.cameraX + MAP_HALF) / MAP_SIZE) * w;
    const camMz = ((data.cameraZ + MAP_HALF) / MAP_SIZE) * h;
    ctx.strokeStyle = 'rgba(232, 227, 216, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(camMx - 18, camMz - 14, 36, 28);
  }, [snapshot, getMinimapData]);

  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const rz = (e.clientY - rect.top) / rect.height;
    const wx = rx * MAP_SIZE - MAP_HALF;
    const wz = rz * MAP_SIZE - MAP_HALF;
    onPanToWorld(wx, wz);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandText.trim()) return;
    onSubmitCommand(commandText);
    setCommandText('');
    inputRef.current?.blur();
  };

  const sel = snapshot.selectedSquad;
  const selAlive = sel ? sel.soldiers.filter((s) => s.alive).length : 0;
  const selTotal = sel ? sel.soldiers.length : 0;
  const selDef = sel ? UNIT_CLASSES[sel.unitClass] : null;
  const selBonuses = sel ? getSquadMedalBonuses(sel) : null;
  const aliveAllies = snapshot.alliedSquads.filter((s) => !s.eliminated);
  const latestMedal = snapshot.recentNotifications[0];

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4">
      {/* Top Row: Telemetry + Squad Quick Strip (Left) & Utility + Minimap (Right) */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left Battle Telemetry & Squad Selector */}
        <div className="pointer-events-auto flex flex-col gap-2">
          <div className="bg-[#0d141f]/90 border border-[#c4a25c]/30 px-4 py-2.5 flex items-center gap-5 shadow-lg">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4]">Allied</div>
              <div className="font-mono-num text-lg font-semibold text-[#5ca4e6]">
                {snapshot.alliedSquadsAlive}/{snapshot.alliedSquadsTotal}
              </div>
            </div>
            <div className="h-6 w-px bg-white/10" aria-hidden="true" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4]">Enemy</div>
              <div className="font-mono-num text-lg font-semibold text-[#e26d5c]">
                {snapshot.enemySquadsAlive}/{snapshot.enemySquadsTotal}
              </div>
            </div>
            <div className="h-6 w-px bg-white/10" aria-hidden="true" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4]">Explored</div>
              <div className="font-mono-num text-lg font-semibold text-[#48b8a0]">
                {snapshot.exploredPercent}%
              </div>
            </div>
            <div className="h-6 w-px bg-white/10" aria-hidden="true" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4]">Time</div>
              <div className="font-mono-num text-lg font-semibold text-[#e8e3d8]">
                {formatTimer(snapshot.elapsedSeconds)}
              </div>
            </div>
          </div>

          {/* Compact Squad Selector Row */}
          <div className="flex flex-wrap items-center gap-1.5 max-w-[440px]">
            {aliveAllies.map((sq, idx) => {
              const isSelected = sel?.id === sq.id;
              return (
                <button
                  key={sq.id}
                  type="button"
                  onClick={() => onSelectSquad(sq.id)}
                  title={`${sq.name} (${Math.round(sq.morale)}% morale)`}
                  className={`px-2 py-1 flex items-center gap-1.5 text-xs border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-[#1f2f44]/95 border-[#e6b84c] text-[#f3ede0]'
                      : sq.routing
                        ? 'bg-[#361c1c]/90 border-[#e26d5c]/50 text-[#f6b95c]'
                        : 'bg-[#0d141f]/88 border-white/15 text-[#cbd5e1] hover:border-white/35'
                  }`}
                >
                  <span className="font-mono-num text-[10px] text-[#8396ab]">{idx + 1}</span>
                  <UnitClassIcon unitClass={sq.unitClass} className="w-3.5 h-3.5" />
                  <span className="font-mono-num text-[11px]">
                    {sq.soldiers.filter((u) => u.alive).length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Top-Center Transient Medal Toast */}
        {latestMedal && snapshot.elapsedSeconds - latestMedal.timestamp < 5.5 && (
          <div className="bg-[#0e1622]/95 border border-[#c4a25c] px-4 py-2 flex items-center gap-3 shadow-xl">
            <MedalIcon
              medalId={latestMedal.medal.id}
              color={latestMedal.medal.accentColor}
              className="w-6 h-6 shrink-0"
            />
            <div>
              <div className="text-xs font-semibold text-[#f2d588]">
                Medal Awarded: {latestMedal.medal.name}
              </div>
              <div className="text-[11px] text-[#cbd5e1]">
                {latestMedal.commanderName} ({latestMedal.squadName}) · {latestMedal.medal.buffSummary}
              </div>
            </div>
          </div>
        )}

        {/* Top-Right Utility Controls & Tactical Minimap */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              title="Mute [M]"
              className="w-9 h-9 flex items-center justify-center bg-[#0d141f]/90 hover:bg-[#1a2638] border border-white/15 text-[#e8e3d8] cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              aria-label="Pause battle"
              title="Pause [P / Esc]"
              className="w-9 h-9 flex items-center justify-center bg-[#0d141f]/90 hover:bg-[#1a2638] border border-white/15 text-[#e8e3d8] cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestart();
              }}
              aria-label="Reset camera and restart"
              title="Restart [R]"
              className="w-9 h-9 flex items-center justify-center bg-[#0d141f]/90 hover:bg-[#1a2638] border border-white/15 text-[#e8e3d8] cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-[#0d141f]/92 border border-[#c4a25c]/30 p-1.5 shadow-lg">
            <canvas
              ref={minimapRef}
              width={132}
              height={132}
              onClick={handleMinimapClick}
              aria-label="Tactical battlefield minimap"
              className="block cursor-crosshair"
            />
          </div>
        </div>
      </div>

      {/* Bottom Row: Selected Squad & 4-Medal Commander Card (Left) + Text Command Bar (Center) */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-3">
        {/* Selected Squad & Commander Card */}
        {sel && selDef && selBonuses ? (
          <div
            data-testid="selected-squad-card"
            className="pointer-events-auto w-full lg:w-[360px] bg-[#0d141f]/94 border border-[#c4a25c]/35 p-3.5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <UnitClassIcon unitClass={sel.unitClass} className="w-7 h-7 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#f3ede0] truncate">{sel.name}</div>
                  <div className="text-[11px] text-[#c4a25c] truncate">{sel.commanderName}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono-num text-sm font-semibold text-[#e8e3d8]">
                  {selAlive}/{selTotal}
                </div>
                <div className="text-[10px] uppercase text-[#9fb0c4]">Troops</div>
              </div>
            </div>

            {/* HP & Morale Bars */}
            <div className="mt-2.5 space-y-2">
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-[#9fb0c4]">Squad Strength</span>
                  <span className="font-mono-num text-[#e8e3d8]">
                    {selTotal > 0 ? Math.round((selAlive / selTotal) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#49b675] transition-all duration-150"
                    style={{ width: `${selTotal > 0 ? (selAlive / selTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-[#9fb0c4]">
                    Morale {sel.routing ? '· ROUTING' : `(Breaks <${ROUT_MORALE_THRESHOLD}%)`}
                  </span>
                  <span
                    className={`font-mono-num ${
                      sel.morale < ROUT_MORALE_THRESHOLD ? 'text-[#e67e22]' : 'text-[#e6c15a]'
                    }`}
                  >
                    {Math.round(sel.morale)}%
                  </span>
                </div>
                <div className="relative h-2 bg-white/10 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      sel.morale < ROUT_MORALE_THRESHOLD ? 'bg-[#e67e22]' : 'bg-[#e6c15a]'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, sel.morale))}%` }}
                  />
                  {/* 25% Routing Threshold Tick */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/70"
                    style={{ left: `${ROUT_MORALE_THRESHOLD}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>

            {/* Active Tactical Modifiers (Zero-Pill clean separators) */}
            <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#cbd5e1] font-mono-num">
              <span className="capitalize">{sel.formation.replace('_', ' ')}</span>
              <span aria-hidden="true">·</span>
              <span>LoS {Math.round(sel.effectiveVision)}m</span>
              <span aria-hidden="true">·</span>
              <span className={sel.onHighGround ? 'text-[#e0a94f]' : 'text-[#9fb0c4]'}>
                {sel.onHighGround ? 'High Ground (+LoS/+ATK)' : sel.lastTerrain}
              </span>
              {(selBonuses.attackMult > 1 || selBonuses.defenseMult > 1) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#48b8a0]">
                    ATK +{Math.round((selBonuses.attackMult - 1) * 100)}%
                  </span>
                </>
              )}
            </div>

            {/* 4 Commander Medal Slots */}
            <div className="mt-2.5 pt-2 border-t border-white/10">
              <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4] mb-1.5">
                Commander Medals ({sel.medals.length}/{MAX_COMMANDER_MEDALS})
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: MAX_COMMANDER_MEDALS }).map((_, slotIdx) => {
                  const medalId = sel.medals[slotIdx];
                  if (!medalId) {
                    return (
                      <div
                        key={slotIdx}
                        className="h-11 border border-dashed border-white/15 bg-[#080d14]/70 flex items-center justify-center text-[10px] text-[#566475]"
                      >
                        Empty
                      </div>
                    );
                  }
                  const medal = MEDALS[medalId];
                  return (
                    <div
                      key={medalId}
                      title={`${medal.name}: ${medal.buffSummary}`}
                      className="h-11 border border-[#c4a25c]/45 bg-[#141f2f] px-1 flex flex-col items-center justify-center text-center"
                    >
                      <MedalIcon
                        medalId={medalId}
                        color={medal.accentColor}
                        className="w-4 h-4"
                      />
                      <span className="text-[9px] text-[#f3ede0] leading-tight mt-0.5 truncate max-w-full">
                        {medal.shortLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden lg:block w-[360px]" />
        )}

        {/* Bottom-Center Tactical Text-Command Input Bar */}
        <div className="pointer-events-auto flex-1 max-w-xl mx-auto w-full">
          {snapshot.commandFeedback && (
            <div className="mb-1.5 px-3 py-1 bg-[#0d141f]/90 border border-[#c4a25c]/30 text-xs text-[#f2d588] text-center truncate">
              {snapshot.commandFeedback}
            </div>
          )}

          <div className="bg-[#0d141f]/94 border border-[#c4a25c]/40 p-2 shadow-2xl">
            {/* Quick-Click Tactical Commands */}
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {QUICK_ORDERS.map((order) => (
                <button
                  key={order}
                  type="button"
                  onClick={() => onSubmitCommand(order)}
                  className="px-2.5 py-1 text-[11px] font-medium bg-[#152030] hover:bg-[#1f2f45] text-[#cbd5e1] hover:text-white border border-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {order}
                </button>
              ))}
            </div>

            <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
              <label htmlFor="tactical-command-input" className="sr-only">
                Tactical text command
              </label>
              <input
                ref={inputRef}
                id="tactical-command-input"
                type="text"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                placeholder='Type order (e.g. "advance", "raise shields", "line formation", "spread out", "split")'
                className="flex-1 bg-[#080d14] border border-white/15 px-3 py-2 text-xs text-[#f3ede0] placeholder-[#6c7d91] focus:outline-none focus:border-[#c4a25c]"
              />
              <button
                type="submit"
                aria-label="Issue tactical order"
                className="px-4 py-2 bg-[#c4a25c] hover:bg-[#d8b770] text-[#0c111a] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Order</span>
              </button>
            </form>
          </div>
        </div>

        <div className="hidden lg:block w-[140px]" />
      </div>
    </div>
  );
};
