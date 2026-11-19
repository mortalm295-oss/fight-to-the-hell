import React from 'react';
import type { DifficultyLevel } from '../game/types';
import { TitleCrestSvg } from './TacticalIcons';

interface TitleOverlayProps {
  armyCount: number;
  armyCost: number;
  difficulty: DifficultyLevel;
  onStartBattle: () => void;
  onOpenSetup: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  armyCount,
  armyCost,
  difficulty,
  onStartBattle,
  onOpenSetup,
}) => {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-8 md:p-12">
      {/* Left-third Title Lockup over calm negative space */}
      <div className="max-w-md pointer-events-auto mt-4 md:mt-10 bg-[#0b111b]/88 border border-[#c4a25c]/30 p-7 shadow-2xl">
        <div className="flex items-center gap-4 mb-5">
          <TitleCrestSvg className="w-14 h-14 shrink-0" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-wider text-[#f3ede0] hud-stroke text-balance leading-tight">
              BULWARK
            </h1>
            <p className="text-sm text-[#c4a25c] font-medium tracking-wide">
              Tactical 2.5D Command
            </p>
          </div>
        </div>

        <p className="text-sm text-[#cbd5e1] leading-relaxed mb-6">
          Command infantry, archers, cavalry, and scouts across elevation ridges, shifting Fog of
          War, and Mandelbulb stone peaks. Direct squads via mouse or typed tactical orders.
        </p>

        <div className="flex items-center gap-3 text-xs text-[#9fb0c4] font-mono-num mb-6 border-t border-white/10 pt-4">
          <span>{armyCount} Squads Ready</span>
          <span aria-hidden="true">·</span>
          <span>{armyCost} / 1000 pts</span>
          <span aria-hidden="true">·</span>
          <span className="capitalize">{difficulty} AI</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onStartBattle}
            className="px-6 py-3 bg-[#c4a25c] hover:bg-[#d8b770] text-[#0c111a] font-semibold text-sm tracking-wide transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#f2d588]"
          >
            Start Battle
          </button>
          <button
            type="button"
            onClick={onOpenSetup}
            className="px-5 py-3 bg-[#152030] hover:bg-[#1e2d42] text-[#e8e3d8] border border-white/15 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#c4a25c]"
          >
            Army Setup
          </button>
        </div>
      </div>

      {/* Single flat control hint line at bottom safe margin */}
      <div className="flex items-center justify-center">
        <p className="text-xs text-[#b8c4d0] hud-stroke tracking-wide text-center">
          Click Squad Select · Right-Click Move or Attack · Enter Command Bar · WASD Pan · Esc Pause
        </p>
      </div>
    </div>
  );
};
