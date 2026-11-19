import React from 'react';
import type { BattleSnapshot } from '../game/types';

interface PauseVictoryModalProps {
  snapshot: BattleSnapshot;
  onResume: () => void;
  onPlayAgain: () => void;
  onOpenSetup: () => void;
  onReturnTitle: () => void;
}

export const PauseVictoryModal: React.FC<PauseVictoryModalProps> = ({
  snapshot,
  onResume,
  onPlayAgain,
  onOpenSetup,
  onReturnTitle,
}) => {
  const isPaused = snapshot.phase === 'paused';
  const isVictory = snapshot.phase === 'gameover' && snapshot.outcome === 'victory';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#070b11]/82">
      <div
        role="dialog"
        aria-label={isPaused ? 'Battle Paused' : isVictory ? 'Victory' : 'Defeat'}
        className="w-full max-w-md bg-[#0e1622] border border-[#c4a25c]/45 p-7 shadow-2xl"
      >
        <h2 className="font-display text-2xl font-bold text-[#f3ede0] tracking-wide">
          {isPaused
            ? 'Command Paused'
            : isVictory
              ? 'Total Victory'
              : 'Army Defeated'}
        </h2>
        <p className="text-sm text-[#9fb0c4] mt-1.5">
          {isPaused
            ? 'Field operations suspended. Resume command or reconfigure your army.'
            : isVictory
              ? 'All opposing forces have been eliminated or routed from the battlefield.'
              : 'Your remaining battalions have fallen or routed from the field.'}
        </p>

        {/* Mastery / Progress Metrics */}
        <div className="grid grid-cols-3 gap-3 my-6 py-4 border-y border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4]">Battle Time</div>
            <div className="font-mono-num text-lg font-semibold text-[#f3ede0] mt-0.5">
              {Math.round(snapshot.elapsedSeconds)}s
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4]">Map Explored</div>
            <div className="font-mono-num text-lg font-semibold text-[#48b8a0] mt-0.5">
              {snapshot.exploredPercent}%
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#9fb0c4]">Medals Earned</div>
            <div className="font-mono-num text-lg font-semibold text-[#c4a25c] mt-0.5">
              {snapshot.medalsAwardedCount}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isPaused ? (
            <button
              type="button"
              onClick={onResume}
              className="px-5 py-2.5 bg-[#c4a25c] hover:bg-[#d8b770] text-[#0c111a] text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              Resume Battle
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onPlayAgain}
              className="px-5 py-2.5 bg-[#c4a25c] hover:bg-[#d8b770] text-[#0c111a] text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              Play Again
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSetup}
            className="px-4 py-2.5 bg-[#152030] hover:bg-[#1e2d42] text-[#e8e3d8] border border-white/15 text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            Army Setup
          </button>
          <button
            type="button"
            onClick={onReturnTitle}
            className="px-4 py-2.5 text-[#9fb0c4] hover:text-white text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
};
